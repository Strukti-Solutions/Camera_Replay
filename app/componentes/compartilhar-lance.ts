// Compartilhar o lance pela folha nativa do celular (Web Share com arquivo).
// Aqui fica só o que dá para testar sem navegador; o botão está em
// botao-compartilhar.tsx.

export const MENSAGEM_FALHA = "Não deu para compartilhar. Baixe o vídeo e envie pelo app.";
export const MENSAGEM_TOCAR_DE_NOVO = "O vídeo está pronto. Toque em Compartilhar de novo.";

// true só quando o navegador diz que compartilha este arquivo. Sem
// navigator.canShare (Firefox no computador, navegadores antigos) é false.
export function podeCompartilharArquivos(nav: Pick<Navigator, "canShare"> | undefined, arquivo: File): boolean {
  try {
    return nav?.canShare?.({ files: [arquivo] }) === true;
  } catch {
    return false;
  }
}

// "20:37" → "lance-20h37.mp4"; "hoje, 20:37" → "lance-hoje-20h37.mp4".
// Só [a-z0-9-]: nome seguro em qualquer app que receba o arquivo. É só o
// plano B de nomeDoArquivoCompartilhado: "hoje" e "ontem" envelhecem.
export function nomeDoArquivoDoLance(horario: string): string {
  const miolo = horario
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d{1,2}):(\d{2})/g, "$1h$2")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return miolo ? `lance-${miolo}.mp4` : "lance.mp4";
}

const NOME_SEGURO = /^lance-[a-z0-9]+(?:-[a-z0-9]+)*\.mp4$/;

// Nome do arquivo compartilhado: o mesmo do "Baixar vídeo"
// (lance-AAAA-MM-DD-HHhMM.mp4, montado no servidor em app/lib/clipes.ts), com
// a data absoluta: quem recebe dias depois pelo WhatsApp não lê um "hoje" que
// já passou. Sem ele, ou fora do formato seguro, usa o nome tirado do horário.
export function nomeDoArquivoCompartilhado(arquivo: string | undefined, horario: string): string {
  return arquivo !== undefined && NOME_SEGURO.test(arquivo) ? arquivo : nomeDoArquivoDoLance(horario);
}

// Baixa o .mp4 pela URL assinada de download e devolve o arquivo, com o nome
// dado, pronto para a folha de compartilhar. Resposta de erro (link vencido)
// lança; sem o CORS do bucket, o próprio fetch lança.
export async function baixarArquivoDoLance(
  download: string,
  nome: string,
  buscar: typeof fetch = fetch,
  sinal?: AbortSignal,
): Promise<File> {
  const resposta = await buscar(download, { signal: sinal });
  if (!resposta.ok) throw new Error(`download do lance respondeu ${resposta.status}`);
  const blob = await resposta.blob();
  return new File([blob], nome, { type: "video/mp4" });
}

function nomeDoErro(erro: unknown): string | undefined {
  return typeof erro === "object" && erro !== null && "name" in erro && typeof erro.name === "string"
    ? erro.name
    : undefined;
}

// null: a pessoa fechou a folha (AbortError), nada a dizer.
// NotAllowedError logo depois de baixar: o navegador só abre a folha logo após
// o toque, e o download pode passar desse prazo (Safari no iPhone, 4G lento).
// O arquivo já está guardado, então outro toque abre a folha na hora.
export function mensagemDaFalha(erro: unknown, acabouDeBaixar: boolean): string | null {
  const nome = nomeDoErro(erro);
  if (nome === "AbortError") return null;
  if (nome === "NotAllowedError" && acabouDeBaixar) return MENSAGEM_TOCAR_DE_NOVO;
  return MENSAGEM_FALHA;
}

import { expect, test } from "vitest";
import {
  MENSAGEM_FALHA,
  MENSAGEM_TOCAR_DE_NOVO,
  baixarArquivoDoLance,
  mensagemDaFalha,
  nomeDoArquivoCompartilhado,
  nomeDoArquivoDoLance,
  podeCompartilharArquivos,
} from "../app/componentes/compartilhar-lance";

const arquivo = new File([], "lance.mp4", { type: "video/mp4" });

test("só compartilha arquivo quando o navegador diz que pode", () => {
  expect(podeCompartilharArquivos(undefined, arquivo)).toBe(false);
  expect(podeCompartilharArquivos({} as Pick<Navigator, "canShare">, arquivo)).toBe(false);
  expect(podeCompartilharArquivos({ canShare: () => false }, arquivo)).toBe(false);
  expect(podeCompartilharArquivos({ canShare: () => true }, arquivo)).toBe(true);
});

test("pergunta ao navegador pelo próprio arquivo", () => {
  let recebido: ShareData | undefined;
  podeCompartilharArquivos(
    {
      canShare: (dados) => {
        recebido = dados;
        return true;
      },
    },
    arquivo,
  );
  expect(recebido).toEqual({ files: [arquivo] });
});

test("nome do arquivo a partir do horário do lance", () => {
  expect(nomeDoArquivoDoLance("20:37")).toBe("lance-20h37.mp4");
  expect(nomeDoArquivoDoLance("9:05")).toBe("lance-9h05.mp4");
});

test("nome do arquivo com o horário como a página mostra (hoje, ontem, dd/mm)", () => {
  expect(nomeDoArquivoDoLance("hoje, 20:37")).toBe("lance-hoje-20h37.mp4");
  expect(nomeDoArquivoDoLance("ontem, 09:05")).toBe("lance-ontem-09h05.mp4");
  expect(nomeDoArquivoDoLance("25/10, 20:37")).toBe("lance-25-10-20h37.mp4");
});

test("nome do arquivo só tem [a-z0-9-] e termina em .mp4", () => {
  for (const horario of ["Sábado, 20:37", "  ", "", "Ação/Ç: 7:00 !!", "20:37"]) {
    expect(nomeDoArquivoDoLance(horario)).toMatch(/^[a-z0-9-]+\.mp4$/);
  }
  expect(nomeDoArquivoDoLance("")).toBe("lance.mp4");
  expect(nomeDoArquivoDoLance("Sábado, 20:37")).toBe("lance-sabado-20h37.mp4");
});

test("arquivo compartilhado leva o nome do Baixar, com a data absoluta", () => {
  // Quem recebe dias depois não pode ler um "hoje" que já passou.
  expect(nomeDoArquivoCompartilhado("lance-2026-10-26-20h37.mp4", "hoje, 20:37")).toBe("lance-2026-10-26-20h37.mp4");
  expect(nomeDoArquivoCompartilhado("lance-2026-10-25-09h05.mp4", "ontem, 09:05")).toBe("lance-2026-10-25-09h05.mp4");
});

test("sem o nome do Baixar, ou fora do formato seguro, cai no nome tirado do horário", () => {
  expect(nomeDoArquivoCompartilhado(undefined, "hoje, 20:37")).toBe("lance-hoje-20h37.mp4");
  expect(nomeDoArquivoCompartilhado("", "20:37")).toBe("lance-20h37.mp4");
  for (const ruim of ["../lance.mp4", "lance 2026.mp4", "lance-2026.MP4", "video.mp4", "lance-.mp4.exe", "Lance-2026-10-26-20h37.mp4"]) {
    expect(nomeDoArquivoCompartilhado(ruim, "20:37")).toBe("lance-20h37.mp4");
  }
});

test("baixa o vídeo e devolve um .mp4 com o nome dado", async () => {
  const pedidos: { url: string; sinal?: AbortSignal | null }[] = [];
  const buscar = (async (url: string, init?: RequestInit) => {
    pedidos.push({ url, sinal: init?.signal });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof fetch;
  const controle = new AbortController();

  const f = await baixarArquivoDoLance(
    "https://r2.exemplo/lance.mp4?assinatura=x", "lance-2026-10-26-20h37.mp4", buscar, controle.signal,
  );

  expect(pedidos).toEqual([{ url: "https://r2.exemplo/lance.mp4?assinatura=x", sinal: controle.signal }]);
  expect(f.name).toBe("lance-2026-10-26-20h37.mp4");
  expect(f.type).toBe("video/mp4");
  expect(f.size).toBe(3);
});

test("resposta de erro do R2 (link vencido) vira falha, não arquivo vazio", async () => {
  const buscar = (async () => new Response("negado", { status: 403 })) as typeof fetch;
  await expect(baixarArquivoDoLance("https://r2.exemplo/x.mp4", "lance-20h37.mp4", buscar)).rejects.toThrow();
});

test("fechar a folha de compartilhar não mostra mensagem", () => {
  expect(mensagemDaFalha(new DOMException("cancelou", "AbortError"), true)).toBeNull();
  expect(mensagemDaFalha(new DOMException("cancelou", "AbortError"), false)).toBeNull();
});

test("o toque venceu enquanto o vídeo baixava: pede outro toque", () => {
  expect(mensagemDaFalha(new DOMException("sem gesto", "NotAllowedError"), true)).toBe(MENSAGEM_TOCAR_DE_NOVO);
  expect(MENSAGEM_TOCAR_DE_NOVO).toBe("O vídeo está pronto. Toque em Compartilhar de novo.");
});

test("outra falha manda baixar e enviar pelo app", () => {
  expect(MENSAGEM_FALHA).toBe("Não deu para compartilhar. Baixe o vídeo e envie pelo app.");
  // Já estava baixado e mesmo assim foi negado: outro toque não resolve.
  expect(mensagemDaFalha(new DOMException("negado", "NotAllowedError"), false)).toBe(MENSAGEM_FALHA);
  expect(mensagemDaFalha(new TypeError("Failed to fetch"), true)).toBe(MENSAGEM_FALHA);
  expect(mensagemDaFalha("qualquer coisa", false)).toBe(MENSAGEM_FALHA);
});

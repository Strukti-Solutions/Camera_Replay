import { textoDeCentavos } from "@/app/lib/precos";
import { ERRO_GENERICO } from "@/app/painel/apresentacao";

// Textos do painel do super admin que têm alguma regra.

export const NOME_ARENA_MAX = 80;
export const ERRO_NOME_ARENA = "Nome da arena inválido (1 a 80 caracteres).";

// Nome aparado, ou null se ficar vazio ou passar de 80 caracteres.
export function nomeDaArena(bruto: string): string | null {
  const nome = bruto.trim();
  return nome.length >= 1 && nome.length <= NOME_ARENA_MAX ? nome : null;
}

// Teto da senha antes do hash: o formulário já limita, mas a action é pública.
export const SENHA_MAX = 200;
export const ERRO_SENHA_LONGA = "Senha longa demais (máximo 200 caracteres).";

export function senhaLongaDemais(senha: string): boolean {
  return senha.length > SENHA_MAX;
}

export function textoStatusArena(status: "ativa" | "suspensa"): string {
  return status === "ativa" ? "Ativa" : "Suspensa";
}

// Linha da confirmação de suspender (o spec pede mostrar antes de suspender).
export function textoReservasFuturas(n: number): string {
  if (n === 0) return "Nenhuma reserva futura confirmada.";
  return n === 1 ? "Esta arena tem 1 reserva futura confirmada." : `Esta arena tem ${n} reservas futuras confirmadas.`;
}

// plataforma.ts (e criarArenaComDono) lançam Error com mensagens fixas. As
// conhecidas viram texto para a equipe; qualquer outra vira a genérica e vai
// para o log só com contexto, nome, código e mensagem. Nunca o objeto inteiro
// (o `detail` do Postgres repete a linha recusada) nem campo do formulário.
const CONHECIDOS: Record<string, string> = {
  "e-mail já cadastrado": "E-mail já cadastrado.",
  "e-mail inválido": "E-mail inválido.",
};
const SENHA_CURTA = /^senha curta: mínimo (\d+) caracteres$/;

export function mensagemErroAdmin(e: unknown, contexto: string): string {
  if (e instanceof Error) {
    const conhecido = CONHECIDOS[e.message];
    if (conhecido) return conhecido;
    const curta = SENHA_CURTA.exec(e.message);
    if (curta) return `Senha curta: mínimo de ${curta[1]} caracteres.`;
    const codigo = (e as { code?: unknown }).code;
    console.error(`[admin] ${contexto} falhou: ${e.name}${typeof codigo === "string" ? ` (${codigo})` : ""}: ${e.message}`);
  } else {
    console.error(`[admin] ${contexto} falhou: valor lançado não é Error (${typeof e})`);
  }
  return ERRO_GENERICO;
}

// Taxa digitada em pt-BR: "10", "7,5", "7,55" (ponto também vale). null se não for
// um número simples; a faixa e as casas são conferidas em definirTaxaArena.
export function lerTaxa(bruto: string): number | null {
  const t = bruto.trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

// 5 -> "5%", 7.5 -> "7,5%".
export function textoTaxa(taxa: number): string {
  return `${String(taxa).replace(".", ",")}%`;
}

// ---------- Mensalidade ----------

const SITUACOES_MENSALIDADE: Record<string, string> = {
  pendente: "em aberto", atrasada: "atrasada", paga: "em dia", estornada: "estornada", cancelada: "cancelada",
};

// Situação de uma cobrança na tela da arena.
export function textoSituacaoMensalidade(situacao: string): string {
  return situacao === "paga" ? "paga" : (SITUACOES_MENSALIDADE[situacao] ?? situacao);
}

// Coluna da lista de arenas: valor e a situação que importa (em dia, em aberto, atrasada).
export function textoMensalidade(centavos: number | null, situacao: string | null): string {
  if (centavos === null) return "Sem mensalidade";
  const s = situacao ? SITUACOES_MENSALIDADE[situacao] : null;
  return s ? `${textoDeCentavos(centavos)} · ${s}` : textoDeCentavos(centavos);
}

// "2026-11-10" -> "10/11/2026".
export function textoVencimento(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

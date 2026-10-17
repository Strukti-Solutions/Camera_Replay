import { SLUG_VALIDO } from "@/app/lib/clipes";
import type { SessaoAluno } from "@/app/lib/acesso-aluno";
import { formatarHorario } from "@/app/lib/formato";
import { textoReserva } from "@/app/painel/apresentacao";

// Regras de texto e de navegação da página do QR. Sem acesso a cookie nem a
// banco, para poder testar direto.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

// "hoje", "ontem" ou "15/10": a parte do dia de formatarHorario ("hoje, 14:32").
export function textoDia(d: Date, agora: Date = new Date()): string {
  return formatarHorario(d, agora).split(",")[0];
}

// "Reserva 8h–10h · hoje".
export function tituloReserva(inicio: Date, fim: Date, agora: Date = new Date()): string {
  return `${textoReserva(inicio, fim)} · ${textoDia(inicio, agora)}`;
}

// Só a primeira palavra do nome: o celular pode ser de outra pessoa olhando junto.
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0];
}

export function textoLances(n: number): string {
  return n === 1 ? "1 lance" : `${n} lances`;
}

// Para onde o aluno vai depois de entrar. Só caminhos montados aqui, nunca o
// valor recebido: slug no formato da quadra e reserva que seja uuid. Slug fora
// do formato devolve null (a ação não redireciona).
export function destinoAposEntrar(slug: string, reserva: string | null | undefined): string | null {
  if (!SLUG_VALIDO.test(slug)) return null;
  return ehUuid(reserva) ? `/q/${slug}/r/${reserva}` : `/q/${slug}`;
}

// A sessão só vale na arena da quadra do QR; de outra arena é "não logado".
export function sessaoDaArena(sessao: SessaoAluno | null, arenaId: string): SessaoAluno | null {
  return sessao && sessao.arenaId === arenaId ? sessao : null;
}

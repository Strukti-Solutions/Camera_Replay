// Horários do dono em minutos desde 00:00 (sem banco): validação, choque entre
// horários do mesmo dia e criação em lote. Fim 1440 significa meia-noite.
import { PRECO_MAX_CENTAVOS } from "./precos";

export type Horario = { diaSemana: number; inicio: number; fim: number; precoCentavos: number };
export type HorarioComId = Horario & { id: string };

export const DURACAO_MIN = 15;
export const DURACAO_MAX = 720;
export const HORARIOS_SEGUIDOS_MAX = 4;
export const DURACOES_FIXOS = [30, 45, 60, 90, 120];

// Só "HH:MM". Como fim, "00:00" quer dizer meia-noite (1440).
export function minutosDeTexto(texto: string, ehFim = false): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(texto);
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return ehFim && min === 0 ? 1440 : min;
}

export function textoMinutos(m: number): string {
  const hora = Math.floor(m / 60), min = m % 60;
  return min === 0 ? `${hora}h` : `${hora}h${String(min).padStart(2, "0")}`;
}

export function textoIntervalo(h: { inicio: number; fim: number }): string {
  return `${textoMinutos(h.inicio)} – ${textoMinutos(h.fim)}`;
}

export function validarHorario(h: Horario): string | null {
  if (!Number.isInteger(h.diaSemana) || h.diaSemana < 0 || h.diaSemana > 6) return "Dia da semana inválido.";
  if (!Number.isInteger(h.inicio) || h.inicio < 0 || h.inicio > 1439) return "Início inválido.";
  if (!Number.isInteger(h.fim) || h.fim < 1 || h.fim > 1440) return "Fim inválido.";
  if (h.fim <= h.inicio) return "O fim deve ser depois do início.";
  const dur = h.fim - h.inicio;
  if (dur < DURACAO_MIN || dur > DURACAO_MAX) return "Cada horário dura de 15 minutos a 12 horas.";
  if (!Number.isInteger(h.precoCentavos) || h.precoCentavos < 1 || h.precoCentavos > PRECO_MAX_CENTAVOS) {
    return "Preço fora do limite permitido.";
  }
  return null;
}

// Encostar (fim de um = início do outro) não é choque.
export function chocam(a: Horario, b: Horario): boolean {
  return a.diaSemana === b.diaSemana && a.inicio < b.fim && b.inicio < a.fim;
}

// Na edição, `ignorarId` tira o próprio horário da comparação.
export function primeiroChoque<T extends Horario & { id?: string }>(
  novo: Horario, existentes: T[], ignorarId?: string,
): T | null {
  return existentes.find((e) => (ignorarId === undefined || e.id !== ignorarId) && chocam(novo, e)) ?? null;
}

// Passos de `duracao` a partir de `das`; o resto que não fecha um horário inteiro cai fora.
export function gerarFixos(p: { diaSemana: number; das: number; ate: number; duracao: number; precoCentavos: number }): Horario[] {
  const saida: Horario[] = [];
  if (p.duracao < 1) return saida;
  for (let inicio = p.das; inicio + p.duracao <= p.ate; inicio += p.duracao) {
    saida.push({ diaSemana: p.diaSemana, inicio, fim: inicio + p.duracao, precoCentavos: p.precoCentavos });
  }
  return saida;
}

// Os novos que chocam com um existente são pulados, não derrubam o lote.
export function separarChoques(novos: Horario[], existentes: Horario[]): { criar: Horario[]; pulados: Horario[] } {
  const criar: Horario[] = [], pulados: Horario[] = [];
  for (const n of novos) (existentes.some((e) => chocam(n, e)) ? pulados : criar).push(n);
  return { criar, pulados };
}

export function grupoDoDia(inicio: number): "madrugada e manhã" | "tarde" | "noite" {
  return inicio < 720 ? "madrugada e manhã" : inicio < 1080 ? "tarde" : "noite";
}

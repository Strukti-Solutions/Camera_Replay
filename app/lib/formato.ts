import type { ClipePainel } from "./painel";

// Formatação só de apresentação, usada pelo site do jogador e pelo painel.
// Horários sempre no fuso da arena (America/Sao_Paulo), não no do servidor.

const FUSO = "America/Sao_Paulo";

const partes = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function noFuso(d: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of partes.formatToParts(d)) p[type] = value;
  return {
    // Dia civil em São Paulo, como número de dias desde a época.
    dia: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000,
    ddmm: `${p.day}/${p.month}`,
    hhmm: `${p.hour}:${p.minute}`,
  };
}

// "hoje, 14:32", "ontem, 21:05" ou "15/10, 09:10".
export function formatarHorario(d: Date, agora: Date = new Date()): string {
  const alvo = noFuso(d);
  const diferenca = noFuso(agora).dia - alvo.dia;
  const rotulo = diferenca === 0 ? "hoje" : diferenca === 1 ? "ontem" : alvo.ddmm;
  return `${rotulo}, ${alvo.hhmm}`;
}

// "31 s", "1 min 05 s"; "—" quando a duração não é conhecida.
export function formatarDuracao(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "—";
  const total = Math.max(0, Math.round(s));
  if (total < 60) return `${total} s`;
  const min = Math.floor(total / 60);
  const seg = String(total % 60).padStart(2, "0");
  return `${min} min ${seg} s`;
}

const STATUS: Record<ClipePainel["status"], string> = {
  pendente: "Na fila",
  processando: "Processando",
  pronto: "Pronto",
  parcial: "Parcial",
  falhou: "Falhou",
};

export function textoStatus(status: ClipePainel["status"]): string {
  return STATUS[status];
}

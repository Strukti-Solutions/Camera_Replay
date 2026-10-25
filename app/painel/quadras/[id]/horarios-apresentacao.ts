// Textos e contagens da tela de horários do dono (sem banco, sem React).
import type { Horario } from "@/app/lib/horarios";

// Índice = dia da semana (0 = domingo).
export function contagemPorDia(horarios: Pick<Horario, "diaSemana">[]): number[] {
  const n = [0, 0, 0, 0, 0, 0, 0];
  for (const h of horarios) if (h.diaSemana >= 0 && h.diaSemana <= 6) n[h.diaSemana] += 1;
  return n;
}

export function avisoReservas(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "Esse horário tem 1 reserva futura; ela continua valendo como foi feita."
    : `Esse horário tem ${n} reservas futuras; elas continuam valendo como foram feitas.`;
}

export function resumoLote(criados: number, pulados: number): string {
  if (criados === 0) return "Nenhum horário criado: todos chocavam com os existentes.";
  const base = `${criados} ${criados === 1 ? "horário criado" : "horários criados"}`;
  if (pulados === 0) return `${base}.`;
  return `${base}; ${pulados} ${pulados === 1 ? "chocava" : "chocavam"} com os existentes e ${pulados === 1 ? "foi pulado" : "foram pulados"}.`;
}

// Minutos desde 00:00 -> "HH:MM" para o campo de hora (1440 vira 00:00).
export function valorHora(minutos: number): string {
  const m = minutos % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Centavos -> texto do campo de preço, sem "R$" ("8000" vira "80,00").
export function precoParaCampo(centavos: number): string {
  return `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, "0")}`;
}

export function rotuloDuracao(min: number): string {
  if (min === 60) return "1 hora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r === 0 ? `${h} horas` : `${h}h${String(r).padStart(2, "0")}`;
}

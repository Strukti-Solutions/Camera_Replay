// Horários livres e preço da escolha (sem banco). A tabela de preços define as
// horas abertas; reservas e bloqueios entram como horas ocupadas.
import type { Faixa } from "./precos";

export const DIAS_A_FRENTE = 30;
export const HORAS_MAX = 4;
export const FUSO = "America/Sao_Paulo";

const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function partesLocais(agora: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(agora).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), minuto: Number(p.minute) };
}

export function hojeLocal(agora: Date): string {
  return partesLocais(agora).dia;
}

function emUtc(dia: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function somaDias(dia: string, n: number): string {
  const d = emUtc(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diaDaSemana(dia: string): number {
  return emUtc(dia).getUTCDay();
}

export function diaValido(dia: unknown, agora: Date): string | null {
  if (typeof dia !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  if (emUtc(dia).toISOString().slice(0, 10) !== dia) return null;
  const hoje = hojeLocal(agora);
  return dia >= hoje && dia <= somaDias(hoje, DIAS_A_FRENTE) ? dia : null;
}

export function diasDisponiveis(agora: Date): { valor: string; rotulo: string }[] {
  const hoje = hojeLocal(agora);
  return Array.from({ length: DIAS_A_FRENTE + 1 }, (_, i) => {
    const valor = somaDias(hoje, i);
    if (i === 0) return { valor, rotulo: "Hoje" };
    if (i === 1) return { valor, rotulo: "Amanhã" };
    return { valor, rotulo: `${SEMANA[diaDaSemana(valor)]}, ${valor.slice(8)}/${valor.slice(5, 7)}` };
  });
}

// Preço de cada hora cheia do dia (hora -> centavos), segundo a tabela.
function precosDoDia(faixas: Faixa[], dia: string): Map<number, number> {
  const ds = diaDaSemana(dia);
  const mapa = new Map<number, number>();
  for (const f of faixas) {
    if (f.diaSemana !== ds) continue;
    for (let h = f.inicio; h < f.fim; h++) mapa.set(h, f.precoCentavos);
  }
  return mapa;
}

export type Inicio = { hora: number; horasMax: number };

// Hora livre: tem preço na tabela e não está ocupada por reserva ou bloqueio.
export function iniciosLivres(faixas: Faixa[], dia: string, agora: Date, ocupadas: Set<number> = new Set()): Inicio[] {
  const precos = precosDoDia(faixas, dia);
  const livre = (h: number) => precos.has(h) && !ocupadas.has(h);
  const local = partesLocais(agora);
  const primeira = dia === local.dia ? local.hora + 1 : dia < local.dia ? 24 : 0;
  const saida: Inicio[] = [];
  for (let h = Math.max(primeira, 0); h < 24; h++) {
    if (!livre(h)) continue;
    let n = 0;
    while (n < HORAS_MAX && livre(h + n)) n++;
    saida.push({ hora: h, horasMax: n });
  }
  return saida;
}

export type Escolha = {
  hora: number;
  horas: number;
  porHora: { hora: number; precoCentavos: number }[];
  totalCentavos: number;
};

export function precoEscolha(
  faixas: Faixa[], dia: string, hora: number, horas: number, agora: Date, ocupadas: Set<number> = new Set(),
): Escolha | null {
  if (!Number.isInteger(hora) || !Number.isInteger(horas) || horas < 1) return null;
  const inicio = iniciosLivres(faixas, dia, agora, ocupadas).find((i) => i.hora === hora);
  if (!inicio || horas > inicio.horasMax) return null;
  const precos = precosDoDia(faixas, dia);
  const porHora = Array.from({ length: horas }, (_, i) => ({ hora: hora + i, precoCentavos: precos.get(hora + i)! }));
  return { hora, horas, porHora, totalCentavos: porHora.reduce((s, x) => s + x.precoCentavos, 0) };
}

// Instante (UTC, em ms) do minuto local `minuto` (desde 00:00; 1440 = meia-noite
// seguinte) do dia `dia` em São Paulo. Começa no palpite de UTC-3 e corrige pelo
// horário local observado (vale se o fuso voltar a ter horário de verão).
export function instanteDoMinuto(dia: string, minuto: number): number {
  const [a, m, d] = dia.split("-").map(Number);
  const alvo = Date.UTC(a, m - 1, d, 0, minuto);
  let t = alvo + 3 * 3_600_000;
  for (let i = 0; i < 2; i++) {
    const p = partesLocais(new Date(t));
    const diff = (emUtc(p.dia).getTime() + (p.hora * 60 + p.minuto) * 60_000) - alvo;
    if (diff === 0) break;
    t -= diff;
  }
  return t;
}

// Início (UTC) da hora local `hora` do dia `dia`.
export function instanteLocal(dia: string, hora: number): number {
  return instanteDoMinuto(dia, hora * 60);
}

// Dia (AAAA-MM-DD) e minuto desde 00:00 locais de um instante.
export function partesDoInstante(d: Date): { dia: string; minuto: number } {
  const p = partesLocais(d);
  return { dia: p.dia, minuto: p.hora * 60 + p.minuto };
}

// Horas locais (0–23) do dia tocadas por algum período [inicio, fim).
export function horasOcupadas(periodos: { inicio: Date; fim: Date }[], dia: string): Set<number> {
  const saida = new Set<number>();
  for (let h = 0; h < 24; h++) {
    const de = instanteLocal(dia, h), ate = de + 3_600_000;
    if (periodos.some((p) => p.inicio.getTime() < ate && p.fim.getTime() > de)) saida.add(h);
  }
  return saida;
}

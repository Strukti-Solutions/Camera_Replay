// Horários livres do dia e preço da escolha (sem banco). Os horários são os que
// o dono criou; reservas e bloqueios entram como períodos ocupados.
import { DURACAO_MAX, HORARIOS_SEGUIDOS_MAX, type HorarioComId } from "./horarios";

export const DIAS_A_FRENTE = 30;
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

export type Periodo = { inicio: Date; fim: Date };
export type HorarioDoDia = { horario: HorarioComId; livre: boolean };

// Horários do dia da semana de `dia`, por início. Sai o que começa em ou antes de
// `agora`; `livre` é falso se algum período ocupado toca o intervalo do horário.
export function horariosDoDia(horarios: HorarioComId[], dia: string, agora: Date, ocupados: Periodo[]): HorarioDoDia[] {
  const ds = diaDaSemana(dia);
  return horarios
    .filter((h) => h.diaSemana === ds)
    .map((h) => ({ h, de: instanteDoMinuto(dia, h.inicio), ate: instanteDoMinuto(dia, h.fim) }))
    .filter((x) => x.de > agora.getTime())
    .sort((x, y) => x.h.inicio - y.h.inicio || x.h.id.localeCompare(y.h.id))
    .map((x) => ({
      horario: x.h,
      livre: !ocupados.some((p) => p.inicio.getTime() < x.ate && p.fim.getTime() > x.de),
    }));
}

export type Escolha = {
  inicio: number;
  fim: number;
  itens: { inicio: number; fim: number; precoCentavos: number }[];
  totalCentavos: number;
};

// `qtd` horários seguidos a partir do livre que começa em `inicio`: cada próximo
// é o livre que começa onde o anterior termina. Qualquer quebra devolve null.
export function escolhaDeHorarios(
  horarios: HorarioComId[], dia: string, inicio: number, qtd: number, agora: Date, ocupados: Periodo[],
): Escolha | null {
  if (!Number.isInteger(inicio) || !Number.isInteger(qtd) || qtd < 1 || qtd > HORARIOS_SEGUIDOS_MAX) return null;
  const livres = horariosDoDia(horarios, dia, agora, ocupados).filter((x) => x.livre).map((x) => x.horario);
  const itens: Escolha["itens"] = [];
  let ponta = inicio;
  for (let i = 0; i < qtd; i++) {
    const h = livres.find((x) => x.inicio === ponta);
    if (!h) return null;
    itens.push({ inicio: h.inicio, fim: h.fim, precoCentavos: h.precoCentavos });
    ponta = h.fim;
  }
  // A reserva inteira cabe em 12 h (check da tabela reservas).
  if (ponta - inicio > DURACAO_MAX) return null;
  return { inicio, fim: ponta, itens, totalCentavos: itens.reduce((t, x) => t + x.precoCentavos, 0) };
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

// Minuto local do fim de um período: meia-noite conta como 1440 (fim do dia do início).
export const minutoDoFim = (d: Date): number => partesDoInstante(d).minuto || 1440;

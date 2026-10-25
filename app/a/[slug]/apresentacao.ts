import {
  DIAS_A_FRENTE, FUSO, diaDaSemana, diaValido, hojeLocal, horariosDoDia, type HorarioDoDia, type Periodo,
} from "@/app/lib/disponibilidade";
import { DURACAO_MAX, HORARIOS_SEGUIDOS_MAX, type HorarioComId } from "@/app/lib/horarios";
import { formatarHorario } from "@/app/lib/formato";

// Regras de texto da página da arena (/a/<slug-da-arena>). Sem acesso a cookie nem a
// banco, para poder testar direto.

// "hoje", "ontem" ou "15/10": a parte do dia de formatarHorario ("hoje, 14:32").
export function textoDia(d: Date, agora: Date = new Date()): string {
  return formatarHorario(d, agora).split(",")[0];
}

export function textoLances(n: number): string {
  return n === 1 ? "1 lance" : `${n} lances`;
}

type Endereco = {
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
};

// Endereço em uma linha: "Rua A, 10 - Centro, Fortaleza - CE". Partes vazias somem.
export function linhaEndereco(e: Endereco | null): string {
  if (!e) return "";
  const limpo = (v: string | null) => (v ?? "").trim();
  const ruaNumero = [limpo(e.rua), limpo(e.numero)].filter(Boolean).join(", ");
  const cidadeUf = [limpo(e.cidade), limpo(e.uf)].filter(Boolean).join(" - ");
  const local = [limpo(e.bairro), cidadeUf].filter(Boolean).join(", ");
  return [ruaNumero, local].filter(Boolean).join(" - ");
}

// Link do Google Maps: pelas coordenadas quando há, senão pelo endereço; nada → null.
export function linkComoChegar(a: {
  latitude: number | null;
  longitude: number | null;
  endereco: Endereco | null;
}): string | null {
  const base = "https://www.google.com/maps/search/?api=1&query=";
  if (a.latitude !== null && a.longitude !== null && Number.isFinite(a.latitude) && Number.isFinite(a.longitude)) {
    return `${base}${a.latitude},${a.longitude}`;
  }
  const linha = linhaEndereco(a.endereco);
  return linha ? base + encodeURIComponent(linha) : null;
}

type Parametros = Record<string, string | string[] | undefined>;

function primeiro(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function inteiroEntre(v: string | undefined, min: number, max: number): number | null {
  if (v === undefined || !/^(0|[1-9]\d{0,3})$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

// Início do horário em minutos desde 00:00 (0 a 1439) e quantidade de horários seguidos.
const inicioDaUrl = (v: string | string[] | undefined) => inteiroEntre(primeiro(v), 0, 1439);
const qtdDaUrl = (v: string | string[] | undefined) => inteiroEntre(primeiro(v), 1, HORARIOS_SEGUIDOS_MAX);

// Escolha da URL (?quadra=&dia=&inicio=&qtd=), sem confiar em nada: o que não
// presta volta ao padrão (sem quadra, hoje, sem início, 1 horário).
export function lerEscolha(
  params: Parametros,
  quadraIds: string[],
  agora: Date,
): { quadra: string | null; dia: string; inicio: number | null; qtd: number } {
  const quadra = primeiro(params.quadra);
  return {
    quadra: quadra !== undefined && quadraIds.includes(quadra) ? quadra : null,
    dia: diaValido(primeiro(params.dia), agora) ?? hojeLocal(agora),
    inicio: inicioDaUrl(params.inicio),
    qtd: qtdDaUrl(params.qtd) ?? 1,
  };
}

// Escolha completa para /reservar: aqui nada volta ao padrão. Quadra fora da
// lista, dia fora da janela, início ou quantidade ausentes ou inválidos → null.
export function lerReserva(
  params: Parametros,
  quadraIds: string[],
  agora: Date,
): { quadra: string; dia: string; inicio: number; qtd: number } | null {
  const e = lerEscolha(params, quadraIds, agora);
  const qtd = qtdDaUrl(params.qtd);
  if (e.quadra === null || e.inicio === null || qtd === null) return null;
  if (diaValido(primeiro(params.dia), agora) === null) return null;
  return { quadra: e.quadra, dia: e.dia, inicio: e.inicio, qtd };
}

// URL do resumo da reserva (contrato: /reservar?quadra=&dia=&inicio=&qtd=).
// Aceita valores crus da URL: tudo vai codificado.
export function hrefReservar(e: {
  quadra: string;
  dia: string;
  inicio: number | string;
  qtd: number | string;
}): string {
  const q = new URLSearchParams({ quadra: e.quadra, dia: e.dia, inicio: String(e.inicio), qtd: String(e.qtd) });
  return `/reservar?${q.toString()}`;
}

export type AcaoDoHorario = "marcar" | "somar" | "tirar" | "desmarcar";

// O que tocar na caixinha `alvo` faz com a seleção: marca só ela, soma um
// horário colado ao fim (até 4 e 12 h), tira o último ou desmarca o único.
export function acaoDoHorario(
  dia: HorarioDoDia[],
  selecao: { inicio: number; qtd: number } | null,
  alvo: number,
): AcaoDoHorario {
  const primeiroIdx = selecao ? dia.findIndex((x) => x.horario.inicio === selecao.inicio) : -1;
  if (!selecao || primeiroIdx < 0) return "marcar";
  const ultimo = primeiroIdx + selecao.qtd - 1;
  const colado = alvo === ultimo + 1 && dia[alvo].livre && dia[alvo].horario.inicio === dia[ultimo]?.horario.fim;
  const cabe = colado && dia[alvo].horario.fim - selecao.inicio <= DURACAO_MAX;
  if (colado && cabe && selecao.qtd < HORARIOS_SEGUIDOS_MAX) return "somar";
  if (alvo === ultimo) return selecao.qtd > 1 ? "tirar" : "desmarcar";
  return "marcar";
}

// Link de uma caixinha de horário (`alvo` = índice em `dia`), conforme acaoDoHorario.
export function hrefDoHorario(
  base: { slug: string; quadra: string; dia: string },
  dia: HorarioDoDia[],
  selecao: { inicio: number; qtd: number } | null,
  alvo: number,
): string {
  const acao = acaoDoHorario(dia, selecao, alvo);
  let inicio: number | null = dia[alvo].horario.inicio;
  let qtd = 1;
  if (selecao && acao === "somar") {
    inicio = selecao.inicio;
    qtd = selecao.qtd + 1;
  } else if (selecao && acao === "tirar") {
    inicio = selecao.inicio;
    qtd = selecao.qtd - 1;
  } else if (acao === "desmarcar") {
    inicio = null;
  }
  const q = new URLSearchParams({ quadra: base.quadra, dia: base.dia });
  if (inicio !== null) {
    q.set("inicio", String(inicio));
    q.set("qtd", String(qtd));
  }
  return `/a/${encodeURIComponent(base.slug)}?${q.toString()}#reserva`;
}

const DIA_EXTENSO = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long" });

// "Segunda-feira, 26 de outubro" para o dia AAAA-MM-DD (meio-dia em São Paulo).
export function diaPorExtenso(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const p = Object.fromEntries(DIA_EXTENSO.formatToParts(new Date(Date.UTC(a, m - 1, d, 15))).map((x) => [x.type, x.value]));
  const semana = p.weekday.charAt(0).toUpperCase() + p.weekday.slice(1);
  return `${semana}, ${p.day} de ${p.month}`;
}

// ---------- Passos da reserva (quadra → dia → horários) ----------

// O passo vem da URL: sem quadra, 1; quadra sem dia, 2; quadra e dia, 3.
export function passoDaEscolha(e: { quadra: string | null; diaNaUrl: boolean }): 1 | 2 | 3 {
  if (e.quadra === null) return 1;
  return e.diaNaUrl ? 3 : 2;
}

// Passo da URL: a quadra tem de ser da arena e o dia, da janela. Link velho
// (?quadra= sozinho) e dia fora da janela abrem o calendário.
export function passoDaUrl(params: Parametros, quadraIds: string[], agora: Date): 1 | 2 | 3 {
  return passoDaEscolha({
    quadra: lerEscolha(params, quadraIds, agora).quadra,
    diaNaUrl: diaValido(primeiro(params.dia), agora) !== null,
  });
}

const somaDias = (dia: string, n: number) => {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

// Dias da janela de reserva: hoje até hoje + DIAS_A_FRENTE.
function diasDaJanela(agora: Date): string[] {
  const hoje = hojeLocal(agora);
  return Array.from({ length: DIAS_A_FRENTE + 1 }, (_, i) => somaDias(hoje, i));
}

// Meses (AAAA-MM) que tocam a janela: um ou dois.
export function mesesDaJanela(agora: Date): string[] {
  return [...new Set(diasDaJanela(agora).map((d) => d.slice(0, 7)))];
}

// Mês do calendário da URL; o que não toca a janela vira o mês de hoje.
export function lerMes(v: string | string[] | undefined, agora: Date): string {
  const m = primeiro(v);
  const meses = mesesDaJanela(agora);
  return m !== undefined && meses.includes(m) ? m : meses[0];
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function nomeDoMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
}

export type EstadoDoDia = "livre" | "poucos" | "indisponivel";

// 3 ou mais livres: livre; 1 ou 2: poucos; nenhum ou fora da janela: indisponível.
export function estadoDoDia(livres: number, valido: boolean): EstadoDoDia {
  if (!valido || livres <= 0) return "indisponivel";
  return livres >= 3 ? "livre" : "poucos";
}

// Horários livres de cada dia da janela (só os que começam depois de agora).
export function livresPorDia(horarios: HorarioComId[], agora: Date, ocupados: Periodo[]): Map<string, number> {
  return new Map(diasDaJanela(agora).map((d) => [d, horariosDoDia(horarios, d, agora, ocupados).filter((x) => x.livre).length]));
}

export type DiaDoCalendario = { dia: string; numero: number; doMes: boolean; estado: EstadoDoDia };

// Semanas de domingo a sábado cobrindo o mês; dias de fora do mês completam as pontas.
export function calendarioDoMes(mes: string, agora: Date, livres: Map<string, number>): DiaDoCalendario[][] {
  const primeiroDia = `${mes}-01`;
  const [a, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const inicio = somaDias(primeiroDia, -diaDaSemana(primeiroDia));
  const fim = somaDias(ultimoDia, 6 - diaDaSemana(ultimoDia));
  const semanas: DiaDoCalendario[][] = [];
  for (let d = inicio; d <= fim; d = somaDias(d, 1)) {
    if (diaDaSemana(d) === 0) semanas.push([]);
    const doMes = d.slice(0, 7) === mes;
    semanas[semanas.length - 1].push({
      dia: d,
      numero: Number(d.slice(8)),
      doMes,
      estado: estadoDoDia(livres.get(d) ?? 0, doMes && livres.has(d)),
    });
  }
  return semanas;
}

const caminhoDaArena = (slug: string) => `/a/${encodeURIComponent(slug)}`;

export function hrefPasso1(slug: string): string {
  return `${caminhoDaArena(slug)}#reserva`;
}

export function hrefPasso2(slug: string, quadra: string, mes?: string): string {
  const q = new URLSearchParams({ quadra });
  if (mes) q.set("mes", mes);
  return `${caminhoDaArena(slug)}?${q.toString()}#reserva`;
}

export function hrefPasso3(slug: string, quadra: string, dia: string): string {
  return `${caminhoDaArena(slug)}?${new URLSearchParams({ quadra, dia }).toString()}#reserva`;
}

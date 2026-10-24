import { FUSO, diaValido, hojeLocal, type HorarioDoDia } from "@/app/lib/disponibilidade";
import { HORARIOS_SEGUIDOS_MAX } from "@/app/lib/horarios";
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
  if (v === undefined || !/^\d{1,4}$/.test(v)) return null;
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

// Link de uma caixinha de horário (`alvo` = índice em `dia`): marca, soma um
// horário seguido, tira o último ou desmarca, conforme a seleção atual.
export function hrefDoHorario(
  base: { slug: string; quadra: string; dia: string },
  dia: HorarioDoDia[],
  selecao: { inicio: number; qtd: number } | null,
  alvo: number,
): string {
  const primeiroIdx = selecao ? dia.findIndex((x) => x.horario.inicio === selecao.inicio) : -1;
  let inicio: number | null = dia[alvo].horario.inicio;
  let qtd = 1;
  if (selecao && primeiroIdx >= 0) {
    const ultimo = primeiroIdx + selecao.qtd - 1;
    const colado = alvo === ultimo + 1 && dia[alvo].livre && dia[alvo].horario.inicio === dia[ultimo]?.horario.fim;
    if (colado && selecao.qtd < HORARIOS_SEGUIDOS_MAX) {
      inicio = selecao.inicio;
      qtd = selecao.qtd + 1;
    } else if (alvo === ultimo && selecao.qtd > 1) {
      inicio = selecao.inicio;
      qtd = selecao.qtd - 1;
    } else if (alvo === ultimo && selecao.qtd === 1) {
      inicio = null;
    }
  }
  const q = new URLSearchParams({ quadra: base.quadra, dia: base.dia });
  if (inicio !== null) {
    q.set("inicio", String(inicio));
    q.set("qtd", String(qtd));
  }
  return `/a/${base.slug}?${q.toString()}#quadra-${base.quadra}`;
}

const DIA_EXTENSO = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long" });

// "Segunda-feira, 26 de outubro" para o dia AAAA-MM-DD (meio-dia em São Paulo).
export function diaPorExtenso(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const p = Object.fromEntries(DIA_EXTENSO.formatToParts(new Date(Date.UTC(a, m - 1, d, 15))).map((x) => [x.type, x.value]));
  const semana = p.weekday.charAt(0).toUpperCase() + p.weekday.slice(1);
  return `${semana}, ${p.day} de ${p.month}`;
}

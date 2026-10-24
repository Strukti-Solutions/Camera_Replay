import { FUSO, HORAS_MAX, diaValido, hojeLocal } from "@/app/lib/disponibilidade";
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
  if (v === undefined || !/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

// Escolha da URL (?quadra=&dia=&inicio=&horas=), sem confiar em nada: o que não
// presta volta ao padrão (sem quadra, hoje, sem início, 1 hora).
export function lerEscolha(
  params: Parametros,
  quadraIds: string[],
  agora: Date,
): { quadra: string | null; dia: string; inicio: number | null; horas: number } {
  const quadra = primeiro(params.quadra);
  return {
    quadra: quadra !== undefined && quadraIds.includes(quadra) ? quadra : null,
    dia: diaValido(primeiro(params.dia), agora) ?? hojeLocal(agora),
    inicio: inteiroEntre(primeiro(params.inicio), 0, 23),
    horas: inteiroEntre(primeiro(params.horas), 1, HORAS_MAX) ?? 1,
  };
}

// Escolha completa para /reservar: aqui nada volta ao padrão. Quadra fora da
// lista, dia fora da janela, início ou duração ausentes ou inválidos → null.
export function lerReserva(
  params: Parametros,
  quadraIds: string[],
  agora: Date,
): { quadra: string; dia: string; inicio: number; horas: number } | null {
  const e = lerEscolha(params, quadraIds, agora);
  const horas = inteiroEntre(primeiro(params.horas), 1, HORAS_MAX);
  if (e.quadra === null || e.inicio === null || horas === null) return null;
  if (diaValido(primeiro(params.dia), agora) === null) return null;
  return { quadra: e.quadra, dia: e.dia, inicio: e.inicio, horas };
}

// URL do resumo da reserva (contrato: /reservar?quadra=&dia=&inicio=&horas=).
// Aceita valores crus da URL: tudo vai codificado.
export function hrefReservar(e: {
  quadra: string;
  dia: string;
  inicio: number | string;
  horas: number | string;
}): string {
  const q = new URLSearchParams({ quadra: e.quadra, dia: e.dia, inicio: String(e.inicio), horas: String(e.horas) });
  return `/reservar?${q.toString()}`;
}

const DIA_EXTENSO = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long" });

// "Segunda-feira, 26 de outubro" para o dia AAAA-MM-DD (meio-dia em São Paulo).
export function diaPorExtenso(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const p = Object.fromEntries(DIA_EXTENSO.formatToParts(new Date(Date.UTC(a, m - 1, d, 15))).map((x) => [x.type, x.value]));
  const semana = p.weekday.charAt(0).toUpperCase() + p.weekday.slice(1);
  return `${semana}, ${p.day} de ${p.month}`;
}

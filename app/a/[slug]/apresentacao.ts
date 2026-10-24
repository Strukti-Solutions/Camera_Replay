import { HORAS_MAX, diaValido, hojeLocal } from "@/app/lib/disponibilidade";
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

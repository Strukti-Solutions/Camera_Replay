import { textoDeCentavos } from "@/app/lib/precos";
import { normalizar } from "@/app/lib/texto-busca";

// Termo da busca da página de escolha da arena (/?busca=). Parâmetro repetido
// vale o primeiro; o corte em 80 é o mesmo de listarArenasPublicas. O NUL sai (o Postgres recusa e o campo o devolveria).
export function termoDaBusca(valor: string | string[] | undefined): string {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, 80) : "";
}

// Esporte do filtro (/?esporte=): só um item da lista do banco, comparado sem
// acento e sem maiúscula. O texto da URL nunca é exibido.
export function lerEsporte(valor: string | string[] | undefined, esportes: string[]): string | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  if (typeof v !== "string" || !v.trim()) return null;
  const chave = normalizar(v);
  return esportes.find((e) => normalizar(e) === chave) ?? null;
}

export function textoAPartirDe(c: { aPartirDe: number | null; porHora: boolean }): string {
  if (c.aPartirDe === null) return "Reservas indisponíveis";
  return `a partir de ${textoDeCentavos(c.aPartirDe)}${c.porHora ? "/h" : ""}`;
}

// Preço curto no pino do mapa: "R$ 80" (centavos só quando há).
export function textoPino(c: { aPartirDe: number | null }): string {
  if (c.aPartirDe === null) return "";
  const t = textoDeCentavos(c.aPartirDe);
  return t.endsWith(",00") ? t.slice(0, -3) : t;
}

export function hrefHome(f: { busca?: string; esporte?: string | null }): string {
  const q = new URLSearchParams();
  if (f.busca) q.set("busca", f.busca);
  if (f.esporte) q.set("esporte", f.esporte);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

export function textoEncontradas(n: number): string {
  if (n === 0) return "Nenhuma arena encontrada.";
  return n === 1 ? "1 arena encontrada" : `${n} arenas encontradas`;
}

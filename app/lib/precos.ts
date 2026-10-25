// Regras puras de dinheiro (sem banco): conversão de texto em centavos, sempre em
// centavos inteiros para não acumular erro de ponto flutuante.

export const PRECO_MAX_CENTAVOS = 1_000_000;
export const NOMES_DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Aceita "80", "80,5", "R$ 1.234,56". Ponto só vale como milhar, nunca como
// decimal: "80.5" é recusado em vez de virar R$ 805,00 por engano.
export function centavosDeTexto(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/, "");
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const reais = Number(m[1].replace(/\./g, ""));
  const centavos = Number((m[2] ?? "").padEnd(2, "0"));
  const total = reais * 100 + centavos;
  return total >= 1 && total <= PRECO_MAX_CENTAVOS ? total : null;
}

export function textoDeCentavos(c: number): string {
  const reais = Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+$)/g, ".");
  return `R$ ${reais},${String(c % 100).padStart(2, "0")}`;
}

export function textoHora(h: number): string {
  return `${h}h`;
}

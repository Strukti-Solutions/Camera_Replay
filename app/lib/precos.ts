// Regras puras da tabela de preços (sem banco): conversão de texto em centavos,
// validação das faixas e detecção de sobreposição. Dinheiro sempre em centavos
// inteiros para não acumular erro de ponto flutuante.
export type Faixa = { diaSemana: number; inicio: number; fim: number; precoCentavos: number };

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

export function validarFaixa(f: Faixa): string | null {
  if (!Number.isInteger(f.diaSemana) || f.diaSemana < 0 || f.diaSemana > 6) return "Dia da semana inválido.";
  if (!Number.isInteger(f.inicio) || f.inicio < 0 || f.inicio > 23) return "Hora de início inválida.";
  if (!Number.isInteger(f.fim) || f.fim < 1 || f.fim > 24) return "Hora de fim inválida.";
  if (f.fim <= f.inicio) return "O fim deve ser depois do início.";
  if (!Number.isInteger(f.precoCentavos) || f.precoCentavos < 1 || f.precoCentavos > PRECO_MAX_CENTAVOS) {
    return "Preço fora do limite permitido.";
  }
  return null;
}

export function sobrepoe(a: Faixa, b: Faixa): boolean {
  return a.diaSemana === b.diaSemana && a.inicio < b.fim && b.inicio < a.fim;
}

export function textoHora(h: number): string {
  return `${h}h`;
}

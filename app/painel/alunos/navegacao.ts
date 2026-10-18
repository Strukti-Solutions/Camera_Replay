// Leitura de ?pagina= e links da lista de alunos (/painel/alunos). O termo da
// busca usa termoDaBusca (app/escolha-arena.ts): primeiro valor, aparado, 80.

// Parâmetro repetido vale o primeiro; qualquer coisa que não seja um inteiro
// positivo curto vira 1. Página além da última é presa em listarAlunos.
export function lerPagina(valor: string | string[] | undefined): number {
  const v = Array.isArray(valor) ? valor[0] : valor;
  if (typeof v !== "string" || !/^\d{1,6}$/.test(v)) return 1;
  return Math.max(1, Number(v));
}

// Link de uma página que mantém a busca. Busca vazia e página 1 ficam fora da URL.
export function hrefPaginaAlunos(busca: string, pagina: number): string {
  const q = new URLSearchParams();
  if (busca) q.set("busca", busca);
  if (pagina > 1) q.set("pagina", String(pagina));
  const s = q.toString();
  return s ? `/painel/alunos?${s}` : "/painel/alunos";
}

export function textoTotalAlunos(n: number): string {
  return n === 1 ? "1 aluno" : `${n} alunos`;
}

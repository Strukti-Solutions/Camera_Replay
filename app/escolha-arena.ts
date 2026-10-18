// Termo da busca da página de escolha da arena (/?busca=). Parâmetro repetido
// vale o primeiro; o corte em 80 é o mesmo de listarArenasPublicas. Também
// serve a /painel/alunos. O NUL sai (o Postgres recusa e o campo o devolveria).
export function termoDaBusca(valor: string | string[] | undefined): string {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, 80) : "";
}

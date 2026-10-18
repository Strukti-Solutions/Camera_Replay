// Termo da busca da página de escolha da arena (/?busca=). Parâmetro repetido
// vale o primeiro; o corte em 80 é o mesmo de listarArenasPublicas.
export function termoDaBusca(valor: string | string[] | undefined): string {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return typeof v === "string" ? v.trim().slice(0, 80) : "";
}

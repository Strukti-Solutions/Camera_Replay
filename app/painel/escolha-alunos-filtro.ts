// Busca e páginas da escolha de alunos, feitas no navegador (a lista inteira
// da arena já vem na página). Função pura: o componente só aplica o resultado.

export const POR_PAGINA_ESCOLHA = 10;

// Sem maiúsculas nem acentos: "joao" acha "João".
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export type ResultadoEscolha = {
  // Ids de todos os alunos na ordem de exibição: fixados primeiro, depois os
  // outros, cada grupo na ordem recebida (por nome).
  ordem: string[];
  // Ids que aparecem na página atual (os demais ficam escondidos, mas no form).
  visiveis: Set<string>;
  pagina: number;
  paginas: number;
  encontrados: number;
};

export function paginarEscolha(
  alunos: { id: string; nome: string }[],
  { fixados, termo, pagina, porPagina = POR_PAGINA_ESCOLHA }: {
    fixados: Set<string>;
    termo: string;
    pagina: number;
    porPagina?: number;
  },
): ResultadoEscolha {
  const ordenados = [...alunos.filter((a) => fixados.has(a.id)), ...alunos.filter((a) => !fixados.has(a.id))];
  const t = normalizar(termo.trim());
  const achados = t ? ordenados.filter((a) => normalizar(a.nome).includes(t)) : ordenados;
  const paginas = Math.max(1, Math.ceil(achados.length / porPagina));
  const p = Math.min(paginas, Math.max(1, Number.isFinite(pagina) ? Math.floor(pagina) : 1));
  const inicio = (p - 1) * porPagina;
  return {
    ordem: ordenados.map((a) => a.id),
    visiveis: new Set(achados.slice(inicio, inicio + porPagina).map((a) => a.id)),
    pagina: p,
    paginas,
    encontrados: achados.length,
  };
}

export function textoSelecionados(n: number): string {
  return n === 1 ? "1 selecionado" : `${n} selecionados`;
}

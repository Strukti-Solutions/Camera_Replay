import { expect, test } from "vitest";
import { hrefPaginaAlunos, lerPagina, textoTotalAlunos } from "../app/painel/alunos/navegacao";
import { paginarEscolha, textoSelecionados } from "../app/painel/escolha-alunos-filtro";

test("lerPagina: primeiro valor, só dígitos, mínimo 1", () => {
  expect(lerPagina(undefined)).toBe(1);
  expect(lerPagina("3")).toBe(3);
  expect(lerPagina(["2", "5"])).toBe(2);
  expect(lerPagina([])).toBe(1);
  expect(lerPagina("0")).toBe(1);
  expect(lerPagina("-2")).toBe(1);
  expect(lerPagina("2.5")).toBe(1);
  expect(lerPagina("abc")).toBe(1);
  expect(lerPagina("9".repeat(30))).toBe(1);
});

test("hrefPaginaAlunos mantém a busca e omite o que é padrão", () => {
  expect(hrefPaginaAlunos("", 1)).toBe("/painel/alunos");
  expect(hrefPaginaAlunos("", 2)).toBe("/painel/alunos?pagina=2");
  expect(hrefPaginaAlunos("ana souza", 3)).toBe("/painel/alunos?busca=ana+souza&pagina=3");
  expect(hrefPaginaAlunos("100%&x=1", 1)).toBe("/painel/alunos?busca=100%25%26x%3D1");
});

test("textoTotalAlunos usa singular e plural", () => {
  expect(textoTotalAlunos(1)).toBe("1 aluno");
  expect(textoTotalAlunos(0)).toBe("0 alunos");
  expect(textoTotalAlunos(39)).toBe("39 alunos");
});

const alunos = Array.from({ length: 23 }, (_, i) => ({
  id: `id-${String(i).padStart(2, "0")}`,
  nome: `Aluno ${String(i).padStart(2, "0")}`,
}));

test("paginarEscolha: 10 por página, página presa entre 1 e a última", () => {
  const p1 = paginarEscolha(alunos, { fixados: new Set(), termo: "", pagina: 1 });
  expect(p1).toMatchObject({ pagina: 1, paginas: 3, encontrados: 23 });
  expect([...p1.visiveis]).toEqual(alunos.slice(0, 10).map((a) => a.id));
  expect(p1.ordem).toEqual(alunos.map((a) => a.id));
  const p99 = paginarEscolha(alunos, { fixados: new Set(), termo: "", pagina: 99 });
  expect(p99.pagina).toBe(3);
  expect([...p99.visiveis]).toEqual(alunos.slice(20).map((a) => a.id));
  expect(paginarEscolha(alunos, { fixados: new Set(), termo: "", pagina: 0 }).pagina).toBe(1);
});

test("paginarEscolha: os fixados (marcados) vêm primeiro e a ordem guarda todos os alunos", () => {
  const r = paginarEscolha(alunos, { fixados: new Set(["id-22", "id-15"]), termo: "", pagina: 1 });
  expect(r.ordem.slice(0, 3)).toEqual(["id-15", "id-22", "id-00"]);
  expect(r.ordem).toHaveLength(23);
  expect(new Set(r.ordem).size).toBe(23);
  expect([...r.visiveis].slice(0, 2)).toEqual(["id-15", "id-22"]);
  expect(r.visiveis.size).toBe(10);
});

test("paginarEscolha: busca por trecho do nome, sem maiúsculas nem acentos", () => {
  const lista = [
    { id: "1", nome: "João Silva" },
    { id: "2", nome: "Maria 100%" },
    { id: "3", nome: "Ana Souza" },
  ];
  const ids = (termo: string) => [...paginarEscolha(lista, { fixados: new Set(), termo, pagina: 1 }).visiveis];
  expect(ids("joao")).toEqual(["1"]);
  expect(ids("  SOUZ ")).toEqual(["3"]);
  expect(ids("%")).toEqual(["2"]);
  expect(ids("")).toEqual(["1", "2", "3"]);
  const nada = paginarEscolha(lista, { fixados: new Set(), termo: "xyz", pagina: 1 });
  expect(nada).toMatchObject({ encontrados: 0, pagina: 1, paginas: 1 });
  expect(nada.visiveis.size).toBe(0);
});

test("textoSelecionados usa singular e plural", () => {
  expect(textoSelecionados(0)).toBe("0 selecionados");
  expect(textoSelecionados(1)).toBe("1 selecionado");
  expect(textoSelecionados(4)).toBe("4 selecionados");
});

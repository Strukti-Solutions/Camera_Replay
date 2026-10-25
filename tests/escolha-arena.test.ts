import { expect, test } from "vitest";
import { hrefHome, lerEsporte, termoDaBusca, textoAPartirDe, textoEncontradas, textoPino } from "../app/escolha-arena";

test("termo da busca vem de ?busca=, aparado e com no máximo 80 caracteres", () => {
  expect(termoDaBusca(undefined)).toBe("");
  expect(termoDaBusca("  sol ")).toBe("sol");
  expect(termoDaBusca(["beira", "sol"])).toBe("beira");
  expect(termoDaBusca([])).toBe("");
  expect(termoDaBusca("x".repeat(200))).toHaveLength(80);
});

test("termo da busca descarta o caractere NUL", () => {
  expect(termoDaBusca("be\u0000ira")).toBe("beira");
  expect(termoDaBusca("\u0000")).toBe("");
});

const esportes = ["Beach tennis", "Futevôlei", "Padel"];

test("lerEsporte: só o que está na lista, sem acento e sem maiúscula", () => {
  expect(lerEsporte(undefined, esportes)).toBeNull();
  expect(lerEsporte("futevolei", esportes)).toBe("Futevôlei");
  expect(lerEsporte(["PADEL", "x"], esportes)).toBe("Padel");
  expect(lerEsporte("<script>", esportes)).toBeNull();
  expect(lerEsporte("", esportes)).toBeNull();
});

test("textoAPartirDe e textoPino", () => {
  expect(textoAPartirDe({ aPartirDe: 8000, porHora: true })).toBe("a partir de R$ 80,00/h");
  expect(textoAPartirDe({ aPartirDe: 8050, porHora: false })).toBe("a partir de R$ 80,50");
  expect(textoAPartirDe({ aPartirDe: null, porHora: false })).toBe("Reservas indisponíveis");
  expect(textoPino({ aPartirDe: 8000 })).toBe("R$ 80");
  expect(textoPino({ aPartirDe: 8050 })).toBe("R$ 80,50");
  expect(textoPino({ aPartirDe: null })).toBe("");
});

test("hrefHome omite o vazio e codifica", () => {
  expect(hrefHome({})).toBe("/");
  expect(hrefHome({ busca: "", esporte: null })).toBe("/");
  expect(hrefHome({ esporte: "Beach tennis" })).toBe("/?esporte=Beach+tennis");
  expect(hrefHome({ busca: "a&b", esporte: "Padel" })).toBe("/?busca=a%26b&esporte=Padel");
});

test("textoEncontradas no singular e no plural", () => {
  expect(textoEncontradas(0)).toBe("Nenhuma arena encontrada.");
  expect(textoEncontradas(1)).toBe("1 arena encontrada");
  expect(textoEncontradas(3)).toBe("3 arenas encontradas");
});

import { expect, test } from "vitest";
import { irmaosAtrasDoMapa, limitesDoMapa, valido, type NoArvore } from "../app/componentes/mapa-arenas-calculo";

const ponto = (latitude: number, longitude: number) => ({ nome: "A", slug: "a", latitude, longitude });

test("sem pontos não há mapa", () => {
  expect(limitesDoMapa([])).toBeNull();
});

test("um ponto só centraliza nele com zoom 14", () => {
  expect(limitesDoMapa([ponto(-23.5, -46.6)])).toEqual({ centro: [-23.5, -46.6], zoom: 14 });
});

test("vários pontos viram a caixa que cabe todos", () => {
  expect(limitesDoMapa([ponto(-23.5, -46.6), ponto(-22.9, -43.2), ponto(-25.4, -49.3)])).toEqual({
    bounds: [
      [-25.4, -49.3],
      [-22.9, -43.2],
    ],
  });
});

test("pontos repetidos no mesmo lugar contam como um ponto só", () => {
  expect(limitesDoMapa([ponto(-23.5, -46.6), ponto(-23.5, -46.6)])).toEqual({ centro: [-23.5, -46.6], zoom: 14 });
});

test("coordenada inválida é ignorada", () => {
  expect(limitesDoMapa([ponto(Number.NaN, -46.6), ponto(-23.5, 200)])).toBeNull();
  expect(limitesDoMapa([ponto(Number.NaN, 0), ponto(-23.5, -46.6)])).toEqual({ centro: [-23.5, -46.6], zoom: 14 });
});

test("valido aceita só coordenada finita dentro dos limites", () => {
  expect(valido(ponto(-23.5, -46.6))).toBe(true);
  expect(valido(ponto(90, 180))).toBe(true);
  expect(valido(ponto(Number.NaN, 0))).toBe(false);
  expect(valido(ponto(0, Number.POSITIVE_INFINITY))).toBe(false);
  expect(valido(ponto(91, 0))).toBe(false);
  expect(valido(ponto(0, -181))).toBe(false);
});

test("irmaosAtrasDoMapa pega os irmãos do mapa e dos ancestrais, até o body", () => {
  type No = NoArvore & { nome: string };
  const no = (nome: string, pai: No | null): No => {
    const n: No = { nome, parentElement: pai, children: [] };
    if (pai) (pai.children as No[]).push(n);
    return n;
  };
  const html = no("html", null);
  const corpo = no("body", html);
  const cabecalho = no("cabecalho", corpo);
  const main = no("main", corpo);
  const busca = no("busca", main);
  const secao = no("secao", main);
  const dentro = no("dentro", secao);
  const lista = no("lista", main);
  const rodape = no("rodape", corpo);
  const nomes = irmaosAtrasDoMapa(secao, corpo).map((n) => n.nome);
  expect(nomes).toEqual(["busca", "lista", "cabecalho", "rodape"]);
  expect(nomes).not.toContain("main");
  expect(nomes).not.toContain("secao");
  expect(nomes).not.toContain("dentro");
  expect(nomes).not.toContain("html");
  void [cabecalho, busca, dentro, lista, rodape];
});

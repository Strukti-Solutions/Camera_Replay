import { expect, test } from "vitest";
import { limitesDoMapa } from "../app/componentes/mapa-arenas-calculo";

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

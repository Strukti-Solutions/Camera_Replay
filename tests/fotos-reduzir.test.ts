import { expect, test } from "vitest";
import { medidaReduzida } from "../app/painel/fotos/reduzir";

test("reduz o lado maior para 1600 mantendo a proporção e nunca aumenta", () => {
  expect(medidaReduzida(4000, 3000)).toEqual({ largura: 1600, altura: 1200 });
  expect(medidaReduzida(3000, 4000)).toEqual({ largura: 1200, altura: 1600 });
  expect(medidaReduzida(1600, 900)).toEqual({ largura: 1600, altura: 900 });
  expect(medidaReduzida(800, 600)).toEqual({ largura: 800, altura: 600 });
  expect(medidaReduzida(4033, 3025)).toEqual({ largura: 1600, altura: 1200 });
  expect(medidaReduzida(10000, 10, 1600)).toEqual({ largura: 1600, altura: 2 });
  expect(medidaReduzida(1000, 500, 500)).toEqual({ largura: 500, altura: 250 });
});

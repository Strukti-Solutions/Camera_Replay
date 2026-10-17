import { expect, test } from "vitest";
import {
  alvoMaisCurto,
  arremesso,
  deslocamento,
  foiArraste,
  indiceEm,
  limitar,
  poseDoCartao,
  usaLoop,
} from "../app/q/[slug]/coverflow";

test("índice do centro: cartão inteiro mais próximo, dobrado no anel", () => {
  expect(indiceEm(0, 5)).toBe(0);
  expect(indiceEm(1.4, 5)).toBe(1);
  expect(indiceEm(1.6, 5)).toBe(2);
  expect(indiceEm(-1, 5)).toBe(4);
  expect(indiceEm(7, 5)).toBe(2);
});

test("deslocamento sem loop é a diferença simples", () => {
  expect(deslocamento(0, 2, 5, false)).toBe(-2);
  expect(deslocamento(4, 0, 5, false)).toBe(4);
});

test("deslocamento com loop pega o caminho mais curto do anel", () => {
  // Último cartão fica logo à esquerda do primeiro.
  expect(deslocamento(4, 0, 5, true)).toBe(-1);
  expect(deslocamento(1, 0, 5, true)).toBe(1);
  expect(deslocamento(0, 4, 5, true)).toBe(1);
  expect(deslocamento(2, 0.5, 5, true)).toBeCloseTo(1.5);
});

test("loop só a partir de 4 lances (com 2 ou 3 o vizinho sumiria na emenda)", () => {
  expect(usaLoop(1)).toBe(false);
  expect(usaLoop(2)).toBe(false);
  expect(usaLoop(3)).toBe(false);
  expect(usaLoop(4)).toBe(true);
});

test("limitar: sem loop prende entre o primeiro e o último", () => {
  expect(limitar(-0.7, 3, false)).toBe(0);
  expect(limitar(5, 3, false)).toBe(2);
  expect(limitar(1.3, 3, false)).toBe(1.3);
  expect(limitar(-3, 6, true)).toBe(-3);
});

test("alvo mais curto: com loop não desenrola o anel inteiro", () => {
  // Alvo atual 9 (= índice 4 de 5); ir ao índice 0 é um passo à frente.
  expect(alvoMaisCurto(0, 9, 5, true)).toBe(10);
  expect(alvoMaisCurto(3, 9, 5, true)).toBe(8);
  expect(alvoMaisCurto(2, 0, 3, false)).toBe(2);
});

test("arremesso leva no máximo dois cartões", () => {
  expect(arremesso(0)).toBe(0);
  expect(arremesso(5)).toBeCloseTo(0.9);
  expect(arremesso(50)).toBe(2);
  expect(arremesso(-50)).toBe(-2);
});

test("toque com tremida de até 6 px não conta como arraste", () => {
  expect(foiArraste(0, 0)).toBe(false);
  expect(foiArraste(4, 4)).toBe(false);
  expect(foiArraste(6, 0)).toBe(false);
  expect(foiArraste(7, 0)).toBe(true);
  expect(foiArraste(0, -8)).toBe(true);
});

test("pose do cartão central: sem giro, sem recuo, opaco e por cima", () => {
  const p = poseDoCartao(0, 300, 5, true);
  expect(p.x).toBe(0);
  expect(p.z).toBeCloseTo(0);
  expect(p.giro).toBeCloseTo(0);
  expect(p.opacidade).toBe(1);
  expect(p.camada).toBe(100);
});

test("pose dos vizinhos: espelhada, recuada e mais apagada", () => {
  const dir = poseDoCartao(1, 300, 5, true);
  const esq = poseDoCartao(-1, 300, 5, true);
  expect(dir.x).toBeGreaterThan(0);
  expect(esq.x).toBe(-dir.x);
  expect(dir.z).toBeLessThan(0);
  expect(esq.giro).toBe(-dir.giro);
  expect(dir.opacidade).toBeCloseTo(0.9);
  expect(dir.camada).toBe(99);
});

test("giro nunca passa de 82 graus", () => {
  expect(Math.abs(poseDoCartao(10, 300, 30, false).giro)).toBeLessThanOrEqual(82);
});

test("com loop, cartão na emenda do anel some antes de pular de lado", () => {
  expect(poseDoCartao(2.5, 300, 5, true).opacidade).toBe(0);
  expect(poseDoCartao(2.5, 300, 5, false).opacidade).toBeGreaterThan(0);
});

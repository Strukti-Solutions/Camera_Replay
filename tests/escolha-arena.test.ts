import { expect, test } from "vitest";
import { termoDaBusca } from "../app/escolha-arena";

test("termo da busca vem de ?busca=, aparado e com no máximo 80 caracteres", () => {
  expect(termoDaBusca(undefined)).toBe("");
  expect(termoDaBusca("  sol ")).toBe("sol");
  expect(termoDaBusca(["beira", "sol"])).toBe("beira");
  expect(termoDaBusca([])).toBe("");
  expect(termoDaBusca("x".repeat(200))).toHaveLength(80);
});

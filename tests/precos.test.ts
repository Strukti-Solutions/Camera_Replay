import { expect, test } from "vitest";
import { centavosDeTexto, textoDeCentavos, validarFaixa, sobrepoe, textoHora, NOMES_DIAS, type Faixa } from "../app/lib/precos";

const f = (diaSemana: number, inicio: number, fim: number, precoCentavos = 8000): Faixa => ({ diaSemana, inicio, fim, precoCentavos });

test("centavosDeTexto", () => {
  expect(centavosDeTexto("80")).toBe(8000);
  expect(centavosDeTexto("80,5")).toBe(8050);
  expect(centavosDeTexto("80,50")).toBe(8050);
  expect(centavosDeTexto("R$ 1.234,56")).toBe(123456);
  expect(centavosDeTexto(" 80,00 ")).toBe(8000);
  for (const ruim of ["0", "-5", "abc", "80.5", "80,555", ""]) expect(centavosDeTexto(ruim)).toBeNull();
});

test("textoDeCentavos", () => {
  expect(textoDeCentavos(8000)).toBe("R$ 80,00");
  expect(textoDeCentavos(123456)).toBe("R$ 1.234,56");
  expect(textoDeCentavos(5)).toBe("R$ 0,05");
});

test("validarFaixa", () => {
  expect(validarFaixa(f(0, 8, 12))).toBeNull();
  expect(validarFaixa(f(0, 23, 24))).toBeNull();
  const ruins = [f(0, 12, 12), f(0, 12, 8), f(0, 24, 25), f(0, 8, 0), f(0, 8, 25), f(7, 8, 12), f(-1, 8, 12), f(0, 8, 12, 0), f(0, 8, 12, 1_000_001)];
  for (const r of ruins) {
    const msg = validarFaixa(r);
    expect(typeof msg).toBe("string");
    expect(msg).not.toBe("");
  }
});

test("sobrepoe", () => {
  expect(sobrepoe(f(1, 8, 12), f(1, 10, 14))).toBe(true);
  expect(sobrepoe(f(1, 8, 12), f(1, 12, 14))).toBe(false);
  expect(sobrepoe(f(1, 8, 12), f(2, 8, 12))).toBe(false);
});

test("textoHora e NOMES_DIAS", () => {
  expect(textoHora(7)).toBe("7h");
  expect(textoHora(24)).toBe("24h");
  expect(NOMES_DIAS).toHaveLength(7);
});

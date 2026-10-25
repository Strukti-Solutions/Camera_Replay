import { expect, test } from "vitest";
import { centavosDeTexto, textoDeCentavos, textoHora, NOMES_DIAS } from "../app/lib/precos";

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

test("textoHora e NOMES_DIAS", () => {
  expect(textoHora(7)).toBe("7h");
  expect(textoHora(24)).toBe("24h");
  expect(NOMES_DIAS).toHaveLength(7);
});

import { expect, test } from "vitest";
import { ipDoCliente } from "../app/entrar/ip";

const cab = (o: Record<string, string>) => new Headers(o);

test("prefere x-real-ip", () => {
  expect(ipDoCliente(cab({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe("1.2.3.4");
});

test("usa o primeiro item de x-forwarded-for", () => {
  expect(ipDoCliente(cab({ "x-forwarded-for": " 5.6.7.8 , 10.0.0.1" }))).toBe("5.6.7.8");
});

test("sem cabeçalhos vira desconhecido", () => {
  expect(ipDoCliente(cab({}))).toBe("desconhecido");
  expect(ipDoCliente(cab({ "x-forwarded-for": " , " }))).toBe("desconhecido");
});

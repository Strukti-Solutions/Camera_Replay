import { expect, test } from "vitest";
import { formatarDuracao, formatarHorario, textoStatus } from "../app/lib/formato";

test("horário de hoje em São Paulo", () => {
  const agora = new Date("2026-10-17T20:00:00Z");
  expect(formatarHorario(new Date("2026-10-17T17:32:00Z"), agora)).toBe("hoje, 14:32");
});

test("virada de dia em São Paulo: 02:30 UTC ainda é ontem lá", () => {
  const agora = new Date("2026-10-17T15:00:00Z");
  expect(formatarHorario(new Date("2026-10-17T02:30:00Z"), agora)).toBe("ontem, 23:30");
});

test("mesmo dia em UTC mas dia seguinte em São Paulo não vira hoje", () => {
  // agora = 16/10 23:30 em SP; clipe = 16/10 22:00 em SP → hoje
  const agora = new Date("2026-10-17T02:30:00Z");
  expect(formatarHorario(new Date("2026-10-17T01:00:00Z"), agora)).toBe("hoje, 22:00");
});

test("dias mais antigos mostram dia/mês", () => {
  const agora = new Date("2026-10-17T15:00:00Z");
  expect(formatarHorario(new Date("2026-10-15T12:10:00Z"), agora)).toBe("15/10, 09:10");
});

test("duração", () => {
  expect(formatarDuracao(31)).toBe("31 s");
  expect(formatarDuracao(65)).toBe("1 min 05 s");
  expect(formatarDuracao(60)).toBe("1 min 00 s");
  expect(formatarDuracao(0)).toBe("0 s");
  expect(formatarDuracao(30.6)).toBe("31 s");
  expect(formatarDuracao(null)).toBe("—");
});

test("texto do status", () => {
  expect(textoStatus("pendente")).toBe("Na fila");
  expect(textoStatus("processando")).toBe("Processando");
  expect(textoStatus("pronto")).toBe("Pronto");
  expect(textoStatus("parcial")).toBe("Parcial");
  expect(textoStatus("falhou")).toBe("Falhou");
});

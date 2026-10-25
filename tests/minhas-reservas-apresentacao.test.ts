import { expect, test } from "vitest";
import { mensagemOk, rotuloSituacao, textoPeriodo } from "../app/minhas-reservas/apresentacao";

test("situação: confirmada, cancelada por você ou pela arena", () => {
  expect(rotuloSituacao("confirmada", null)).toBe("Confirmada");
  expect(rotuloSituacao("cancelada", "jogador")).toBe("Cancelada por você");
  expect(rotuloSituacao("cancelada", "dono")).toBe("Cancelada pela arena");
  expect(rotuloSituacao("cancelada", null)).toBe("Cancelada pela arena");
});

test("situação: motivo do cancelamento só quando quem cancelou foi a arena", () => {
  expect(rotuloSituacao("cancelada", "dono", "Chuva forte")).toBe("Cancelada pela arena · Chuva forte");
  expect(rotuloSituacao("cancelada", "dono", null)).toBe("Cancelada pela arena");
  expect(rotuloSituacao("cancelada", "jogador", "qualquer")).toBe("Cancelada por você");
  expect(rotuloSituacao("confirmada", null, "qualquer")).toBe("Confirmada");
});

test("?ok= só aceita os valores exatos e nunca devolve o que veio na URL", () => {
  expect(mensagemOk("reservada")).toBe("Reserva confirmada.");
  expect(mensagemOk("cancelada")).toBe("Reserva cancelada.");
  expect(mensagemOk(["cancelada", "x"])).toBe("Reserva cancelada.");
  expect(mensagemOk("<b>oi</b>")).toBeNull();
  expect(mensagemOk("Reservada")).toBeNull();
  expect(mensagemOk(undefined)).toBeNull();
});

test("período: dia por extenso e horas no fuso de São Paulo", () => {
  // 26/10/2026, 16h às 18h em São Paulo (UTC-3).
  expect(textoPeriodo(new Date("2026-10-26T19:00:00Z"), new Date("2026-10-26T21:00:00Z"))).toBe(
    "Segunda-feira, 26 de outubro · 16h às 18h",
  );
});

test("período: horário com minutos (15h30 às 17h15) e fim à meia-noite como 24h", () => {
  // 15h30–17h15 em São Paulo = 18h30–20h15 UTC
  expect(textoPeriodo(new Date("2026-10-26T18:30:00Z"), new Date("2026-10-26T20:15:00Z"))).toBe(
    "Segunda-feira, 26 de outubro · 15h30 às 17h15",
  );
  // 22h–00h
  expect(textoPeriodo(new Date("2026-10-27T01:00:00Z"), new Date("2026-10-27T03:00:00Z"))).toBe(
    "Segunda-feira, 26 de outubro · 22h às 24h",
  );
});

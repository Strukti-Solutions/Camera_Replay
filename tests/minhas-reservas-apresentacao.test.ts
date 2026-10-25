import { expect, test } from "vitest";
import {
  POR_PAGINA, hrefLista, hrefReservarDeNovo, lerAba, mensagemOk, paginar, rotuloSituacao, seloDaReserva, seloData, textoCancelaAte, textoHorario,
  textoPeriodo,
} from "../app/minhas-reservas/apresentacao";

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

test("aba: só 'historico' abre o histórico", () => {
  expect(lerAba("historico")).toBe("historico");
  expect(lerAba(["historico", "x"])).toBe("historico");
  expect(lerAba("proximas")).toBe("proximas");
  expect(lerAba("Historico")).toBe("proximas");
  expect(lerAba(undefined)).toBe("proximas");
});

test("paginar: 6 por página, página inválida é a 1 e passar da última é a última", () => {
  const lista = Array.from({ length: 8 }, (_, i) => i);
  expect(POR_PAGINA).toBe(6);
  expect(paginar(lista, undefined)).toEqual({ itens: [0, 1, 2, 3, 4, 5], pagina: 1, totalPaginas: 2 });
  expect(paginar(lista, "2")).toEqual({ itens: [6, 7], pagina: 2, totalPaginas: 2 });
  expect(paginar(lista, "99").pagina).toBe(2);
  expect(paginar(lista, ["2", "1"]).pagina).toBe(2);
  for (const v of ["0", "-1", "1.5", "abc", "01", "", "99999"]) expect(paginar(lista, v).pagina).toBe(1);
  expect(paginar([], "3")).toEqual({ itens: [], pagina: 1, totalPaginas: 1 });
  expect(paginar(lista, "1", 4)).toEqual({ itens: [0, 1, 2, 3], pagina: 1, totalPaginas: 2 });
});

test("href da lista: página 1 fica fora da URL", () => {
  expect(hrefLista("proximas", 1)).toBe("/minhas-reservas");
  expect(hrefLista("proximas", 2)).toBe("/minhas-reservas?pagina=2");
  expect(hrefLista("historico", 1)).toBe("/minhas-reservas?aba=historico");
  expect(hrefLista("historico", 3)).toBe("/minhas-reservas?aba=historico&pagina=3");
});

test("selo da data: semana curta e dia sem zero, no fuso de São Paulo", () => {
  expect(seloData(new Date("2026-10-26T21:00:00Z"))).toEqual({ semana: "seg", dia: "26" });
  expect(seloData(new Date("2026-11-07T15:00:00Z"))).toEqual({ semana: "sáb", dia: "7" });
  // 03h30 UTC = 0h30 de domingo em São Paulo.
  expect(seloData(new Date("2026-11-01T03:30:00Z"))).toEqual({ semana: "dom", dia: "1" });
});

test("horário do cartão: minutos e fim à meia-noite como 24h", () => {
  expect(textoHorario(new Date("2026-10-26T21:00:00Z"), new Date("2026-10-26T23:00:00Z"))).toBe("18h às 20h");
  expect(textoHorario(new Date("2026-10-26T18:30:00Z"), new Date("2026-10-26T20:15:00Z"))).toBe("15h30 às 17h15");
  expect(textoHorario(new Date("2026-10-27T01:00:00Z"), new Date("2026-10-27T03:00:00Z"))).toBe("22h às 24h");
});

test("cancelamento grátis até 24 h antes do início", () => {
  // seg 26/10 18h → dom 25/10 18h
  expect(textoCancelaAte(new Date("2026-10-26T21:00:00Z"))).toBe("cancelamento grátis até dom 25, 18h");
  // seg 26/10 0h30 → dom 25/10 0h30
  expect(textoCancelaAte(new Date("2026-10-26T03:30:00Z"))).toBe("cancelamento grátis até dom 25, 0h30");
});

test("selo da reserva: confirmada, jogada ou cancelada (com o motivo da arena)", () => {
  const agora = new Date("2026-10-26T20:00:00Z");
  const base = { situacao: "confirmada", canceladaPor: null, motivoCancelamento: null };
  expect(seloDaReserva({ ...base, fim: new Date("2026-10-26T21:00:00Z") }, agora)).toEqual({ texto: "Confirmada", tom: "ok" });
  expect(seloDaReserva({ ...base, fim: agora }, agora)).toEqual({ texto: "Jogada", tom: "jogada" });
  expect(seloDaReserva(
    { situacao: "cancelada", canceladaPor: "dono", motivoCancelamento: "Chuva forte", fim: new Date("2026-10-27T00:00:00Z") }, agora,
  )).toEqual({ texto: "Cancelada pela arena · Chuva forte", tom: "cancelada" });
  expect(seloDaReserva({ situacao: "cancelada", canceladaPor: "jogador", motivoCancelamento: null, fim: agora }, agora))
    .toEqual({ texto: "Cancelada por você", tom: "cancelada" });
});

test("reservar de novo: página da arena com a quadra escolhida", () => {
  expect(hrefReservarDeNovo("SFGth-S7Bi", "q-1")).toBe("/a/SFGth-S7Bi?quadra=q-1#reserva");
  expect(hrefReservarDeNovo("a b", "x&y")).toBe("/a/a%20b?quadra=x%26y#reserva");
});

import { expect, test } from "vitest";
import {
  destinoAposEntrar,
  primeiroNome,
  sessaoDaArena,
  textoDia,
  textoLances,
  tituloReserva,
  tituloReservaNaQuadra,
} from "../app/a/[slug]/apresentacao";

// 17/10/2026, 17:00 em São Paulo.
const agora = new Date("2026-10-17T20:00:00Z");
const SLUG = "demo-arena-beira-mar-01";
const RESERVA = "0b8f4a52-3c1e-4d7a-9f00-1a2b3c4d5e6f";

test("dia da reserva: hoje, ontem ou dd/mm, no dia civil de São Paulo", () => {
  expect(textoDia(new Date("2026-10-17T11:00:00Z"), agora)).toBe("hoje");
  // 23:30 de 16/10 em São Paulo já é 17/10 em UTC: continua "ontem".
  expect(textoDia(new Date("2026-10-17T02:30:00Z"), agora)).toBe("ontem");
  expect(textoDia(new Date("2026-10-15T12:00:00Z"), agora)).toBe("15/10");
});

test("título da reserva com o dia", () => {
  expect(tituloReserva(new Date("2026-10-17T11:00:00Z"), new Date("2026-10-17T13:00:00Z"), agora)).toBe(
    "Reserva 8h–10h · hoje",
  );
});

test("título da reserva com o nome da quadra, para a lista da arena", () => {
  expect(
    tituloReservaNaQuadra(new Date("2026-10-17T11:00:00Z"), new Date("2026-10-17T13:00:00Z"), "Quadra 2"),
  ).toBe("Reserva 8h–10h · Quadra 2");
});

test("quantidade de lances no singular e no plural", () => {
  expect(textoLances(1)).toBe("1 lance");
  expect(textoLances(4)).toBe("4 lances");
});

test("depois de entrar: volta para a reserva pedida só se r for uuid", () => {
  expect(destinoAposEntrar(SLUG, RESERVA)).toBe(`/a/${SLUG}/r/${RESERVA}`);
  expect(destinoAposEntrar(SLUG, RESERVA.toUpperCase())).toBe(`/a/${SLUG}/r/${RESERVA.toUpperCase()}`);
  expect(destinoAposEntrar(SLUG, null)).toBe(`/a/${SLUG}`);
  expect(destinoAposEntrar(SLUG, "")).toBe(`/a/${SLUG}`);
  expect(destinoAposEntrar(SLUG, "https://evil.example/x")).toBe(`/a/${SLUG}`);
  expect(destinoAposEntrar(SLUG, "//evil.example")).toBe(`/a/${SLUG}`);
  expect(destinoAposEntrar(SLUG, `${RESERVA}/../../x`)).toBe(`/a/${SLUG}`);
  expect(destinoAposEntrar(SLUG, ` ${RESERVA}`)).toBe(`/a/${SLUG}`);
});

test("depois de entrar: slug malformado nunca vira caminho", () => {
  expect(destinoAposEntrar("../painel", RESERVA)).toBeNull();
  expect(destinoAposEntrar("//evil.example/aaaaaaaaaaaaaaaaaaaa", null)).toBeNull();
});

test("sessão de outra arena conta como não logado", () => {
  const sessao = { alunoId: "a", arenaId: "arena-1", nome: "Ana Souza" };
  expect(sessaoDaArena(sessao, "arena-1")).toBe(sessao);
  expect(sessaoDaArena(sessao, "arena-2")).toBeNull();
  expect(sessaoDaArena(null, "arena-1")).toBeNull();
});

test("saudação usa só o primeiro nome do aluno", () => {
  expect(primeiroNome("Lucas Andrade Souza")).toBe("Lucas");
  expect(primeiroNome("  Marina   Costa ")).toBe("Marina");
  expect(primeiroNome("Pedro")).toBe("Pedro");
});

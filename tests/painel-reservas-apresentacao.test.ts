import { expect, test } from "vitest";
import type { ItemAgenda } from "../app/lib/reservas";
import {
  MSG_DONO_NAO_CANCELOU,
  MSG_MOTIVO_LONGO,
  dividirAgenda,
  intervaloAgenda,
  linhaItem,
  mensagemOkAgenda,
  porDia,
  quadraDoFiltro,
} from "../app/painel/reservas/apresentacao";

const AGORA = new Date("2026-10-24T15:00:00Z"); // 12h em São Paulo

function item(p: Partial<ItemAgenda>): ItemAgenda {
  return {
    id: "1", tipo: "reserva", quadraId: "q1", quadra: "Quadra 1", esporte: "Padel",
    inicio: new Date("2026-10-26T19:00:00Z"), fim: new Date("2026-10-26T21:00:00Z"),
    situacao: "confirmada", jogador: "Ana", totalCentavos: 20000, motivo: null, canceladaPor: null, futura: true,
    ...p,
  };
}

test("mensagemOkAgenda só aceita os valores fixos", () => {
  expect(mensagemOkAgenda("cancelada")).toBe("Reserva cancelada.");
  expect(mensagemOkAgenda("bloqueado")).toBe("Horário bloqueado.");
  expect(mensagemOkAgenda("removido")).toBe("Bloqueio removido.");
  expect(mensagemOkAgenda(["removido", "x"])).toBe("Bloqueio removido.");
  expect(mensagemOkAgenda("<script>")).toBeNull();
  expect(mensagemOkAgenda(undefined)).toBeNull();
});

test("mensagens fixas do cancelamento pelo dono", () => {
  expect(MSG_MOTIVO_LONGO).toBe("O motivo pode ter até 120 caracteres.");
  expect(MSG_DONO_NAO_CANCELOU).toBe("Não foi possível cancelar. A reserva já começou ou não existe mais.");
});

test("linhaItem: reserva, conta apagada, quadra sem esporte, bloqueio e canceladas", () => {
  expect(linhaItem(item({}))).toBe("16h–18h · Quadra 1 — Padel · Ana · R$ 200,00 · Confirmada");
  expect(linhaItem(item({ jogador: "Conta apagada", esporte: "" }))).toBe(
    "16h–18h · Quadra 1 · Conta apagada · R$ 200,00 · Confirmada",
  );
  // atravessa a meia-noite: 22h–1h; terminar à meia-noite é 24h
  expect(linhaItem(item({ inicio: new Date("2026-10-27T01:00:00Z"), fim: new Date("2026-10-27T04:00:00Z") }))).toMatch(/^22h–1h /);
  expect(linhaItem(item({ inicio: new Date("2026-10-27T01:00:00Z"), fim: new Date("2026-10-27T03:00:00Z") }))).toMatch(/^22h–24h /);
  expect(linhaItem(item({ situacao: "cancelada", canceladaPor: "jogador" }))).toMatch(/ · Cancelada pelo jogador$/);
  expect(linhaItem(item({ situacao: "cancelada", canceladaPor: "dono", motivo: null }))).toMatch(/ · Cancelada pela arena$/);
  expect(linhaItem(item({ tipo: "bloqueio", jogador: null, totalCentavos: null, motivo: "Aula" }))).toBe(
    "16h–18h · Quadra 1 — Padel · Bloqueado · Aula",
  );
  expect(linhaItem(item({ tipo: "bloqueio", jogador: null, totalCentavos: null, motivo: "Aula", situacao: "cancelada" }))).toBe(
    "16h–18h · Quadra 1 — Padel · Bloqueado · Aula · Removido",
  );
});

test("intervaloAgenda: 30 dias para trás até 13 dias à frente; agenda tem 14 dias", () => {
  expect(intervaloAgenda(AGORA)).toEqual({ de: "2026-09-24", ate: "2026-11-06", dias: expect.any(Array) });
  const { dias } = intervaloAgenda(AGORA);
  expect(dias).toHaveLength(14);
  expect(dias[0]).toBe("2026-10-24");
  expect(dias[13]).toBe("2026-11-06");
});

test("dividirAgenda: próximas confirmadas em ordem; histórico com passadas e canceladas, mais recentes primeiro", () => {
  const jogo = item({ id: "jogo" });
  const agoraJogando = item({ id: "agora", inicio: new Date("2026-10-24T14:00:00Z"), fim: new Date("2026-10-24T16:00:00Z"), futura: false });
  const passada = item({ id: "passada", inicio: new Date("2026-10-01T19:00:00Z"), fim: new Date("2026-10-01T20:00:00Z"), futura: false });
  const antiga = item({ id: "antiga", inicio: new Date("2026-09-25T19:00:00Z"), fim: new Date("2026-09-25T20:00:00Z"), futura: false });
  const cancelada = item({ id: "cancelada", situacao: "cancelada", canceladaPor: "jogador" });
  const { proximas, historico } = dividirAgenda([antiga, passada, agoraJogando, jogo, cancelada], AGORA);
  expect(proximas.map((i) => i.id)).toEqual(["agora", "jogo"]);
  expect(historico.map((i) => i.id)).toEqual(["cancelada", "passada", "antiga"]);
});

test("porDia agrupa pelo dia local do início, mantendo os dias vazios", () => {
  const a = item({ id: "a" });
  const b = item({ id: "b", inicio: new Date("2026-10-27T01:00:00Z"), fim: new Date("2026-10-27T03:00:00Z") }); // 26/10 22h
  const c = item({ id: "c", inicio: new Date("2026-10-27T12:00:00Z"), fim: new Date("2026-10-27T13:00:00Z") });
  const g = porDia(["2026-10-26", "2026-10-27", "2026-10-28"], [a, b, c]);
  expect(g.map((x) => [x.dia, x.itens.map((i) => i.id)])).toEqual([
    ["2026-10-26", ["a", "b"]], ["2026-10-27", ["c"]], ["2026-10-28", []],
  ]);
});

test("quadraDoFiltro só aceita quadra da arena", () => {
  const quadras = [{ id: "q1" }, { id: "q2" }];
  expect(quadraDoFiltro("q2", quadras)).toBe("q2");
  expect(quadraDoFiltro(["q1"], quadras)).toBe("q1");
  expect(quadraDoFiltro("outra", quadras)).toBeNull();
  expect(quadraDoFiltro("", quadras)).toBeNull();
  expect(quadraDoFiltro(undefined, quadras)).toBeNull();
});

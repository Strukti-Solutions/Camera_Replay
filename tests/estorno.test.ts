import { expect, test, vi } from "vitest";
import { ErroAsaas, type PagamentoAsaas } from "../app/lib/asaas";
import type { Db } from "../app/lib/db";
import { abrirPagamento, estornarAposCancelar, estornarReserva, processarEventoAsaas } from "../app/lib/pagamentos";
import { marcarEstornoResolvido, pendenciasDePagamento } from "../app/lib/plataforma";
import { cancelarPeloDono, cancelarPeloJogador, criarReserva } from "../app/lib/reservas";
import { novoBanco } from "./db";
import { arenaOnline, asaasFalso, WALLET } from "./fixtures-asaas";

const AGORA = new Date("2026-11-09T10:00:00-03:00");
const DIA = "2026-11-10";
const APP = "https://replay.exemplo";
const PAGO: PagamentoAsaas = {
  id: "pay_1", status: "CONFIRMED", valorCentavos: 20000, liquidoCentavos: 19802, checkout: "chk-1",
  splits: [{ id: "spl_1", carteira: WALLET, valorCentavos: 18812 }], assinatura: null, vencimento: null, link: null,
};

// Reserva online de 18h às 20h já paga (confirmada pelo webhook).
async function paga(falharEstorno = false) {
  const db = await novoBanco();
  const base = await arenaOnline(db);
  const r = await criarReserva(db, base.jogadorId, { quadraId: base.quadra.id, dia: DIA, inicio: 18 * 60, qtd: 2 }, AGORA, { online: true });
  if (!r.ok) throw new Error();
  const f = asaasFalso(false, { "chk-1": [PAGO] });
  await abrirPagamento(db, f.asaas, base.jogadorId, r.reservaId, APP);
  expect(await processarEventoAsaas(db, f.asaas, { id: "evt_1", event: "CHECKOUT_PAID", checkout: { id: "chk-1" } }, AGORA)).toBe("ok");
  const g = falharEstorno ? asaasFalso(true, { "chk-1": [PAGO] }) : f;
  return { db, ...base, reservaId: r.reservaId, f: g };
}
const reserva = (db: Db, id: string) =>
  db.query<Record<string, unknown>>("select * from reservas where id = $1", [id]).then((r) => r.rows[0]);

test("jogador cancela reserva paga: volta o líquido (sem a tarifa), dono devolve o split inteiro", async () => {
  const { db, jogadorId, reservaId, f } = await paga();
  expect(await cancelarPeloJogador(db, jogadorId, reservaId, AGORA)).toBe(true);
  expect(await estornarAposCancelar(db, f.asaas, reservaId)).toBe("solicitado");
  expect(f.estornos).toEqual([{ pagamento: "pay_1", valorCentavos: 19802, splits: [{ id: "spl_1", valorCentavos: 18812 }] }]);
  expect(await reserva(db, reservaId)).toMatchObject({ estorno: "solicitado", estorno_centavos: 19802 });
  // Chamar de novo não estorna duas vezes.
  expect(await estornarAposCancelar(db, f.asaas, reservaId)).toBe("nada");
  expect(f.estornos).toHaveLength(1);
});

test("dono cancela reserva paga: volta tudo; o dono devolve o split inteiro e a Strukti cobre a tarifa", async () => {
  // O Asaas recusa estornar do split mais que o próprio split (sandbox, 26/10/2026).
  const { db, arena, reservaId, f } = await paga();
  expect(await cancelarPeloDono(db, arena.id, reservaId, "Chuva", AGORA)).toBe(true);
  expect(await estornarAposCancelar(db, f.asaas, reservaId)).toBe("solicitado");
  expect(f.estornos).toEqual([{ pagamento: "pay_1", valorCentavos: 20000, splits: [{ id: "spl_1", valorCentavos: 18812 }] }]);
  expect(await reserva(db, reservaId)).toMatchObject({ estorno: "solicitado", estorno_centavos: 20000 });
});

test("estorno que falha fica pendente (aparece no admin)", async () => {
  const { db, jogadorId, reservaId, f } = await paga(true);
  await cancelarPeloJogador(db, jogadorId, reservaId, AGORA);
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await estornarAposCancelar(db, f.asaas, reservaId)).toBe("pendente");
  erro.mockRestore();
  expect(await reserva(db, reservaId)).toMatchObject({ estorno: "pendente", estorno_centavos: null });
});

test("sem Asaas configurado, reserva paga cancelada fica com estorno pendente; reserva na arena não faz nada", async () => {
  const { db, jogadorId, reservaId } = await paga();
  await cancelarPeloJogador(db, jogadorId, reservaId, AGORA);
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await estornarAposCancelar(db, null, reservaId)).toBe("pendente");
  erro.mockRestore();

  const db2 = await novoBanco();
  const b = await arenaOnline(db2, false);
  const r = await criarReserva(db2, b.jogadorId, { quadraId: b.quadra.id, dia: DIA, inicio: 8 * 60, qtd: 1 }, AGORA);
  if (!r.ok) throw new Error();
  await cancelarPeloJogador(db2, b.jogadorId, r.reservaId, AGORA);
  expect(await estornarAposCancelar(db2, null, r.reservaId)).toBe("nada");
});

test("dono cancela reserva segurada (ainda sem pagamento): cancela o Checkout, sem estorno", async () => {
  const db = await novoBanco();
  const { arena, quadra, jogadorId } = await arenaOnline(db);
  const r = await criarReserva(db, jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 1 }, AGORA, { online: true });
  if (!r.ok) throw new Error();
  const f = asaasFalso();
  await abrirPagamento(db, f.asaas, jogadorId, r.reservaId, APP);
  expect(await cancelarPeloDono(db, arena.id, r.reservaId, "", AGORA)).toBe(true);
  expect(await estornarAposCancelar(db, f.asaas, r.reservaId)).toBe("nada");
  expect(f.asaas.cancelarCheckout).toHaveBeenCalledWith("chk-1");
  expect(f.estornos).toEqual([]);
});

test("estornarReserva só em reserva cancelada; sem o split da carteira da arena fica pendente", async () => {
  const { db, reservaId, f } = await paga();
  expect(await estornarReserva(db, f.asaas, reservaId, "sem_tarifa")).toBe(false); // confirmada: não estorna
  expect(f.estornos).toEqual([]);
  await db.query("update reservas set situacao = 'cancelada', cancelada_por = 'jogador' where id = $1", [reservaId]);
  vi.mocked(f.asaas.pagamento).mockResolvedValueOnce({ ...PAGO, splits: [] });
  expect(await estornarReserva(db, f.asaas, reservaId, "sem_tarifa")).toBe(false);
  expect(f.estornos).toEqual([]);
  expect(await reserva(db, reservaId)).toMatchObject({ estorno: "pendente" });
});

test("duas chamadas de estornarReserva ao mesmo tempo estornam uma vez só", async () => {
  const { db, jogadorId, reservaId, f } = await paga();
  await cancelarPeloJogador(db, jogadorId, reservaId, AGORA);
  const r = await Promise.all([
    estornarReserva(db, f.asaas, reservaId, "sem_tarifa"), estornarReserva(db, f.asaas, reservaId, "sem_tarifa"),
  ]);
  expect(r.filter(Boolean)).toHaveLength(1);
  expect(f.estornos).toHaveLength(1);
});

test("admin: reserva paga cancelada sem pedido de estorno (a função caiu no meio) aparece nas pendências", async () => {
  const { db, jogadorId, reservaId } = await paga();
  await cancelarPeloJogador(db, jogadorId, reservaId, AGORA);
  await db.query("update reservas set cancelada_em = now() - interval '10 minutes' where id = $1", [reservaId]);
  expect((await pendenciasDePagamento(db)).estornos.map((e) => e.reservaId)).toEqual([reservaId]);
  expect(await marcarEstornoResolvido(db, reservaId)).toBe(true);
  expect((await pendenciasDePagamento(db)).estornos).toEqual([]);
});

test("admin: evento parado (sem processado_em) há mais de 5 min aparece como não processado", async () => {
  const db = await novoBanco();
  await db.query("insert into asaas_eventos (id, tipo, payload, recebido_em) values ('evt_p', 'CHECKOUT_PAID', '{}', now() - interval '10 minutes')");
  await db.query("insert into asaas_eventos (id, tipo, payload) values ('evt_novo', 'CHECKOUT_PAID', '{}')");
  expect((await pendenciasDePagamento(db)).eventos.map((e) => [e.id, e.erro])).toEqual([["evt_p", "não processado"]]);
});

import { expect, test, vi } from "vitest";
import type { PagamentoAsaas } from "../app/lib/asaas";
import type { Db } from "../app/lib/db";
import { criarContaJogador } from "../app/lib/jogadores";
import { abrirPagamento, criarHandlerWebhookAsaas, processarEventoAsaas } from "../app/lib/pagamentos";
import { criarReserva } from "../app/lib/reservas";
import { novoBanco } from "./db";
import { arenaOnline, asaasFalso, WALLET } from "./fixtures-asaas";

const AGORA = new Date("2026-11-09T10:00:00-03:00");
const DIA = "2026-11-10";
const APP = "https://replay.exemplo";

const pago = (id = "pay_1", status = "CONFIRMED"): PagamentoAsaas => ({
  id, status, valorCentavos: 20000, liquidoCentavos: 19802, checkout: "chk-1",
  splits: [{ id: "spl_1", carteira: WALLET, valorCentavos: 18812 }],
});

// Reserva online de 18h às 20h com o Checkout chk-1 aberto.
async function cenario(pagamentos: Record<string, PagamentoAsaas[]> = { "chk-1": [pago()] }) {
  const db = await novoBanco();
  const base = await arenaOnline(db);
  const r = await criarReserva(db, base.jogadorId, { quadraId: base.quadra.id, dia: DIA, inicio: 18 * 60, qtd: 2 }, AGORA, { online: true });
  if (!r.ok) throw new Error();
  const f = asaasFalso(false, pagamentos);
  await abrirPagamento(db, f.asaas, base.jogadorId, r.reservaId, APP);
  return { db, ...base, reservaId: r.reservaId, f };
}
const reserva = (db: Db, id: string) =>
  db.query<Record<string, unknown>>("select * from reservas where id = $1", [id]).then((r) => r.rows[0]);
const evtCheckout = (id: string, event: string) => ({ id, event, checkout: { id: "chk-1", status: "PAID" } });

test("CHECKOUT_PAID confirma com os dados da API; evento repetido e evento seguinte não fazem nada", async () => {
  const { db, reservaId, f } = await cenario();
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("ok");
  expect(await reserva(db, reservaId)).toMatchObject({
    situacao: "confirmada", asaas_pagamento_id: "pay_1", pago_centavos: 20000, liquido_centavos: 19802,
  });
  expect((await reserva(db, reservaId)).pago_em).not.toBeNull();
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("repetido");
  const seguinte = { id: "evt_2", event: "PAYMENT_RECEIVED", payment: { id: "pay_1", externalReference: reservaId } };
  expect(await processarEventoAsaas(db, f.asaas, seguinte, AGORA)).toBe("ok");
  expect(f.estornos).toEqual([]);
  const ev = await db.query("select id, processado_em, erro from asaas_eventos order by id");
  expect(ev.rows.map((e) => [e.id, e.processado_em !== null, e.erro])).toEqual([["evt_1", true, null], ["evt_2", true, null]]);
});

test("PAYMENT_CONFIRMED sozinho (sem CHECKOUT_PAID) também confirma, achando a reserva pela externalReference", async () => {
  const { db, reservaId, f } = await cenario();
  const ev = { id: "evt_9", event: "PAYMENT_CONFIRMED", payment: { id: "pay_1", externalReference: reservaId } };
  expect(await processarEventoAsaas(db, f.asaas, ev, AGORA)).toBe("ok");
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "confirmada", asaas_pagamento_id: "pay_1" });
});

test("CHECKOUT_PAID sem cobrança confirmada na API: não confirma e registra o erro", async () => {
  const { db, reservaId, f } = await cenario({ "chk-1": [pago("pay_1", "PENDING")] });
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("erro");
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "segurada" });
  const ev = await db.query<{ erro: string }>("select erro from asaas_eventos");
  expect(ev.rows[0].erro).toContain("sem cobrança confirmada");
});

test("pagamento atrasado com o horário livre: confirma mesmo expirada", async () => {
  const { db, reservaId, f } = await cenario();
  await db.query("update reservas set situacao = 'expirada' where id = $1", [reservaId]);
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("ok");
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "confirmada" });
});

test("pagamento atrasado com o horário ocupado: cancela e estorna sem a tarifa (líquido, split do dono inteiro)", async () => {
  const { db, quadra, reservaId, f } = await cenario();
  await db.query("update reservas set situacao = 'expirada' where id = $1", [reservaId]);
  const outra = await criarContaJogador(db, { nome: "Bia", email: "bia@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!outra.ok) throw new Error();
  expect((await criarReserva(db, outra.jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 1 }, AGORA, { online: true })).ok).toBe(true);
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("ok");
  expect(await reserva(db, reservaId)).toMatchObject({
    situacao: "cancelada", asaas_pagamento_id: "pay_1", estorno: "solicitado", estorno_centavos: 19802,
    motivo_cancelamento: "Pagamento depois do prazo; o horário já estava ocupado.",
  });
  expect(f.estornos).toEqual([{ pagamento: "pay_1", valorCentavos: 19802, splits: [{ id: "spl_1", valorCentavos: 18812 }] }]);
});

test("CHECKOUT_EXPIRED expira a segurada; PAYMENT_REFUNDED conclui o estorno", async () => {
  const { db, reservaId, f } = await cenario();
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_EXPIRED"), AGORA)).toBe("ok");
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "expirada" });

  await db.query("update reservas set situacao = 'cancelada', asaas_pagamento_id = 'pay_1', estorno = 'solicitado' where id = $1", [reservaId]);
  const ev = { id: "evt_2", event: "PAYMENT_REFUNDED", payment: { id: "pay_1", externalReference: reservaId } };
  expect(await processarEventoAsaas(db, f.asaas, ev, AGORA)).toBe("ok");
  expect(await reserva(db, reservaId)).toMatchObject({ estorno: "concluido" });
});

test("evento inválido não grava; reserva desconhecida grava com erro; tipo sem uso é ignorado", async () => {
  const { db, f } = await cenario();
  expect(await processarEventoAsaas(db, f.asaas, { event: "CHECKOUT_PAID" }, AGORA)).toBe("invalido");
  expect(await processarEventoAsaas(db, f.asaas, "lixo", AGORA)).toBe("invalido");
  const desconhecido = { id: "evt_x", event: "CHECKOUT_PAID", checkout: { id: "chk-outro" } };
  expect(await processarEventoAsaas(db, f.asaas, desconhecido, AGORA)).toBe("erro");
  expect(await processarEventoAsaas(db, f.asaas, { id: "evt_y", event: "PAYMENT_CREATED", payment: { id: "pay_1" } }, AGORA)).toBe("ignorado");
  const ev = await db.query<{ id: string; erro: string | null }>("select id, erro from asaas_eventos order by id");
  expect(ev.rows).toEqual([{ id: "evt_x", erro: "reserva não encontrada" }, { id: "evt_y", erro: null }]);
});

test("handler: 503 sem token configurado, 401 com token errado, 400 com corpo ruim, 200 processado", async () => {
  const { db, reservaId, f } = await cenario();
  const post = (token: string | null, corpo: string) =>
    new Request("http://x/api/asaas/webhook", {
      method: "POST", body: corpo, headers: token ? { "asaas-access-token": token } : {},
    });
  const corpo = JSON.stringify(evtCheckout("evt_1", "CHECKOUT_PAID"));
  expect((await criarHandlerWebhookAsaas(db, f.asaas, undefined)(post("t", corpo))).status).toBe(503);
  expect((await criarHandlerWebhookAsaas(db, null, "token-certo")(post("token-certo", corpo))).status).toBe(503);
  expect((await criarHandlerWebhookAsaas(db, f.asaas, "token-certo")(post("errado", corpo))).status).toBe(401);
  expect((await criarHandlerWebhookAsaas(db, f.asaas, "token-certo")(post(null, corpo))).status).toBe(401);
  expect((await criarHandlerWebhookAsaas(db, f.asaas, "token-certo")(post("token-certo", "{"))).status).toBe(400);
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "segurada" });
  const ok = await criarHandlerWebhookAsaas(db, f.asaas, "token-certo", () => AGORA)(post("token-certo", corpo));
  expect(ok.status).toBe(200);
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "confirmada" });
  // Erro de processamento também responde 200 (o evento fica registrado com o erro; a fila do Asaas não pausa).
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  const r = await criarHandlerWebhookAsaas(db, f.asaas, "token-certo")(post("token-certo", JSON.stringify({ id: "evt_z", event: "CHECKOUT_PAID", checkout: { id: "nada" } })));
  expect(r.status).toBe(200);
  erro.mockRestore();
});

test("dois eventos de pagamento ao mesmo tempo: confirma uma vez e nunca estorna", async () => {
  const { db, reservaId, f } = await cenario();
  const outro = { id: "evt_2", event: "PAYMENT_CONFIRMED", payment: { id: "pay_1", externalReference: reservaId } };
  const r = await Promise.all([
    processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA),
    processarEventoAsaas(db, f.asaas, outro, AGORA),
  ]);
  expect(r).toEqual(["ok", "ok"]);
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "confirmada", estorno: null });
  expect(f.estornos).toEqual([]);
});

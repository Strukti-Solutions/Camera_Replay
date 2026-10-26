import { expect, test, vi } from "vitest";
import { ErroAsaas, type PagamentoAsaas } from "../app/lib/asaas";
import type { Db } from "../app/lib/db";
import { criarArenaComDono } from "../app/lib/donos";
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
  splits: [{ id: "spl_1", carteira: WALLET, valorCentavos: 18812 }], assinatura: null, vencimento: null, link: null,
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

test("aoConfirmar: chamado uma vez, só quando o evento confirmou a reserva", async () => {
  const { db, reservaId, f } = await cenario();
  const confirmadas: string[] = [];
  const ao = (id: string) => void confirmadas.push(id);
  await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA, ao);
  await processarEventoAsaas(db, f.asaas, { id: "evt_2", event: "PAYMENT_RECEIVED", payment: { id: "pay_1", externalReference: reservaId } }, AGORA, ao);
  expect(confirmadas).toEqual([reservaId]);
});

// ---------- Achados da revisão ----------

test("cobrança com valor diferente do total não confirma", async () => {
  const { db, reservaId, f } = await cenario({ "chk-1": [{ ...pago(), valorCentavos: 100 }] });
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("erro");
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "segurada", asaas_pagamento_id: null });
  expect((await db.query<{ erro: string }>("select erro from asaas_eventos")).rows[0].erro).toBe("valor pago diferente do total");
});

test("PAYMENT_* de cobrança que não é do Checkout da reserva não confirma (mesmo com a externalReference certa)", async () => {
  const { db, reservaId, f } = await cenario({ "chk-1": [], "chk-outro": [{ ...pago("pay_x"), checkout: "chk-outro" }] });
  const ev = { id: "evt_1", event: "PAYMENT_CONFIRMED", payment: { id: "pay_x", externalReference: reservaId } };
  expect(await processarEventoAsaas(db, f.asaas, ev, AGORA)).toBe("erro");
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "segurada", asaas_pagamento_id: null });
  expect((await db.query<{ erro: string }>("select erro from asaas_eventos")).rows[0].erro).toBe("cobrança de outro Checkout");
});

test("segunda cobrança para a reserva já paga não é aceita", async () => {
  const { db, reservaId, f } = await cenario({ "chk-1": [pago("pay_1"), pago("pay_2")] });
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("ok");
  const ev = { id: "evt_2", event: "PAYMENT_CONFIRMED", payment: { id: "pay_2", externalReference: reservaId } };
  expect(await processarEventoAsaas(db, f.asaas, ev, AGORA)).toBe("erro");
  expect(await reserva(db, reservaId)).toMatchObject({ asaas_pagamento_id: "pay_1" });
});

test("split para outra carteira não confirma; baixa em dinheiro (RECEIVED_IN_CASH) também não", async () => {
  const outra = { ...pago(), splits: [{ id: "spl_1", carteira: "11111111-2222-3333-4444-555555555555", valorCentavos: 18812 }] };
  const a = await cenario({ "chk-1": [outra] });
  expect(await processarEventoAsaas(a.db, a.f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("erro");
  expect(await reserva(a.db, a.reservaId)).toMatchObject({ situacao: "segurada" });
  const b = await cenario({ "chk-1": [pago("pay_1", "RECEIVED_IN_CASH")] });
  expect(await processarEventoAsaas(b.db, b.f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("erro");
  expect(await reserva(b.db, b.reservaId)).toMatchObject({ situacao: "segurada" });
});

test("erro passageiro (Asaas fora do ar): apaga o evento e responde 503 para o Asaas reenviar", async () => {
  const { db, reservaId, f } = await cenario();
  vi.mocked(f.asaas.pagamentosDoCheckout).mockRejectedValueOnce(new Error("fetch failed"));
  const handler = criarHandlerWebhookAsaas(db, f.asaas, "tok", () => AGORA);
  const req = () => new Request("https://x/api/asaas/webhook", {
    method: "POST", headers: { "asaas-access-token": "tok" }, body: JSON.stringify(evtCheckout("evt_1", "CHECKOUT_PAID")),
  });
  expect((await handler(req())).status).toBe(503);
  expect((await db.query("select 1 from asaas_eventos")).rows).toEqual([]);
  expect((await handler(req())).status).toBe(200);
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "confirmada" });
});

test("corpo grande demais: 413", async () => {
  const { db, f } = await cenario();
  const handler = criarHandlerWebhookAsaas(db, f.asaas, "tok", () => AGORA);
  const r = await handler(new Request("https://x/api/asaas/webhook", {
    method: "POST", headers: { "asaas-access-token": "tok" }, body: "x".repeat(70_000),
  }));
  expect(r.status).toBe(413);
});

test("estorno parcial (PAYMENT_PARTIALLY_REFUNDED) conclui; estorno negado volta a pendente", async () => {
  const { db, reservaId, f } = await cenario();
  await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA);
  await db.query("update reservas set situacao = 'cancelada', estorno = 'solicitado' where id = $1", [reservaId]);
  await processarEventoAsaas(db, f.asaas, { id: "evt_2", event: "PAYMENT_REFUND_DENIED", payment: { id: "pay_1" } }, AGORA);
  expect(await reserva(db, reservaId)).toMatchObject({ estorno: "pendente" });
  await processarEventoAsaas(db, f.asaas, { id: "evt_3", event: "PAYMENT_PARTIALLY_REFUNDED", payment: { id: "pay_1" } }, AGORA);
  expect(await reserva(db, reservaId)).toMatchObject({ estorno: "concluido" });
});

test("dono cancelou a segurada e o jogador pagou depois: estorno integral", async () => {
  const { db, reservaId, f } = await cenario();
  await db.query("update reservas set situacao = 'cancelada', cancelada_por = 'dono', cancelada_em = now() where id = $1", [reservaId]);
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("ok");
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "cancelada", estorno: "solicitado", estorno_centavos: 20000 });
  expect(f.estornos[0].valorCentavos).toBe(20000);
});

test("429 do Asaas (limite de requisições) é passageiro: evento apagado para reenvio", async () => {
  const { db, f } = await cenario();
  vi.mocked(f.asaas.pagamentosDoCheckout).mockRejectedValueOnce(new ErroAsaas(429, "too_many_requests"));
  expect(await processarEventoAsaas(db, f.asaas, evtCheckout("evt_1", "CHECKOUT_PAID"), AGORA)).toBe("falhou");
  expect((await db.query("select 1 from asaas_eventos")).rows).toEqual([]);
});

// ---------- Mensalidade ----------

test("cobrança de assinatura vai para a mensalidade, com os dados lidos da API", async () => {
  const db = await novoBanco();
  const { arenaId } = await criarArenaComDono(db, { arena: "Arena Sol", email: "dono@arena.com", senha: "senha-do-dono-123" });
  await db.query("update arenas set asaas_assinatura_id = 'sub_1', mensalidade_centavos = 14990, mensalidade_dia = 10 where id = $1", [arenaId]);
  const cobr: PagamentoAsaas = {
    id: "pay_m1", status: "OVERDUE", valorCentavos: 14990, liquidoCentavos: 14891, checkout: null, splits: [],
    assinatura: "sub_1", vencimento: "2026-11-10", link: "https://sandbox.asaas.com/i/m1",
  };
  const f = asaasFalso(false, { "": [cobr] });
  // O payload diz RECEIVED e outro valor; vale o que a API devolve.
  const ev = { id: "evt_m1", event: "PAYMENT_OVERDUE", payment: { id: "pay_m1", subscription: "sub_1", status: "RECEIVED", value: 1 } };
  expect(await processarEventoAsaas(db, f.asaas, ev, AGORA)).toBe("ok");
  const m = await db.query("select arena_id, valor_centavos, situacao from mensalidades");
  expect(m.rows).toEqual([{ arena_id: arenaId, valor_centavos: 14990, situacao: "atrasada" }]);
  // PAYMENT_DELETED também confere na API (deleted: true).
  vi.mocked(f.asaas.pagamento).mockResolvedValueOnce({ ...cobr, excluida: true });
  const del = { id: "evt_m2", event: "PAYMENT_DELETED", payment: { id: "pay_m1", subscription: "sub_1" } };
  expect(await processarEventoAsaas(db, f.asaas, del, AGORA)).toBe("ok");
  expect((await db.query("select situacao from mensalidades")).rows).toEqual([{ situacao: "cancelada" }]);
  // Assinatura que não é do Replay (outra da conta da Strukti): ignorada, sem erro no admin.
  const outra = asaasFalso(false, { "": [{ ...cobr, id: "pay_m9", assinatura: "sub_x", referencia: "nao-e-arena" }] });
  const ev9 = { id: "evt_m9", event: "PAYMENT_CREATED", payment: { id: "pay_m9", subscription: "sub_x" } };
  expect(await processarEventoAsaas(db, outra.asaas, ev9, AGORA)).toBe("ignorado");
  expect((await db.query("select erro from asaas_eventos where id = 'evt_m9'")).rows).toEqual([{ erro: null }]);
  // Primeira cobrança chegou antes de a assinatura ser gravada: 503 para o Asaas reenviar.
  const { arenaId: nova } = await criarArenaComDono(db, { arena: "Arena Lua", email: "lua@arena.com", senha: "senha-do-dono-123" });
  const cedo = asaasFalso(false, { "": [{ ...cobr, id: "pay_c1", assinatura: "sub_novo", referencia: nova, criadoEm: "2026-11-09" }] });
  const ev10 = { id: "evt_m10", event: "PAYMENT_CREATED", payment: { id: "pay_c1", subscription: "sub_novo" } };
  expect(await processarEventoAsaas(db, cedo.asaas, ev10, AGORA)).toBe("falhou");
  expect((await db.query("select 1 from asaas_eventos where id = 'evt_m10'")).rows).toEqual([]);
});

test("reserva com subscription forjado no payload: a API diz que não é assinatura e nada muda na reserva", async () => {
  const { db, reservaId, f } = await cenario();
  const ev = { id: "evt_f", event: "PAYMENT_CONFIRMED", payment: { id: "pay_1", subscription: "sub_1", externalReference: reservaId } };
  expect(await processarEventoAsaas(db, f.asaas, ev, AGORA)).toBe("erro");
  expect(await reserva(db, reservaId)).toMatchObject({ situacao: "segurada", asaas_pagamento_id: null });
});

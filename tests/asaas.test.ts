import { expect, test, vi } from "vitest";
import { criarAsaas, lerConfigAsaas, reaisDeCentavos } from "../app/lib/asaas";

const CHAVE = "$aact_hmlg_chave_super_secreta";
const CONFIG = { chave: CHAVE, base: "https://api-sandbox.asaas.com/v3" };
const WALLET = "0f0e8c2a-6c4e-4c4c-9a3c-1b2d3e4f5a6b";

function fetcherCom(...respostas: { status?: number; corpo: unknown }[]) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const r = respostas.shift() ?? { corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  });
  return { fetcher, chamadas };
}
const corpo = (c: { init: RequestInit }) => JSON.parse(String(c.init.body));

test("lerConfigAsaas: sem chave é null; ambiente escolhe a URL", () => {
  expect(lerConfigAsaas({})).toBeNull();
  expect(lerConfigAsaas({ ASAAS_API_KEY: "  " })).toBeNull();
  expect(lerConfigAsaas({ ASAAS_API_KEY: CHAVE })).toEqual({ chave: CHAVE, base: "https://api-sandbox.asaas.com/v3" });
  expect(lerConfigAsaas({ ASAAS_API_KEY: CHAVE, ASAAS_AMBIENTE: "producao" })).toEqual({ chave: CHAVE, base: "https://api.asaas.com/v3" });
});

test("reaisDeCentavos", () => {
  expect(reaisDeCentavos(10000)).toBe(100);
  expect(reaisDeCentavos(9901)).toBe(99.01);
  expect(reaisDeCentavos(1)).toBe(0.01);
});

test("criarCheckout: Pix e cartão, 10 min, split percentual para o dono, sem dados do cliente", async () => {
  const f = fetcherCom({ corpo: { id: "chk-1", link: "https://sandbox.asaas.com/c/chk-1", status: "ACTIVE" } });
  const r = await criarAsaas(CONFIG, f.fetcher).criarCheckout({
    reservaId: "res-1", item: "Quadra 1 · Padel com nome bem comprido", descricao: "Arena Sol · ter 10/11 · 18h às 20h",
    totalCentavos: 20000, carteiraDono: WALLET, percentualDono: 95, urlRetorno: "https://x.com/minhas-reservas",
  });
  expect(r).toEqual({ id: "chk-1", link: "https://sandbox.asaas.com/c/chk-1" });
  const c = f.chamadas[0];
  expect(c.url).toBe("https://api-sandbox.asaas.com/v3/checkouts");
  expect(c.init.method).toBe("POST");
  expect(new Headers(c.init.headers).get("access_token")).toBe(CHAVE);
  const b = corpo(c);
  expect(b).toMatchObject({
    billingTypes: ["PIX", "CREDIT_CARD"], chargeTypes: ["DETACHED"], minutesToExpire: 10, externalReference: "res-1",
    callback: { successUrl: "https://x.com/minhas-reservas?ok=paga", cancelUrl: "https://x.com/minhas-reservas", expiredUrl: "https://x.com/minhas-reservas" },
    splits: [{ walletId: WALLET, percentageValue: 95 }],
  });
  expect(b.items).toHaveLength(1);
  expect(b.items[0].name.length).toBeLessThanOrEqual(30);
  expect(b.items[0]).toMatchObject({ quantity: 1, value: 200, description: "Arena Sol · ter 10/11 · 18h às 20h" });
  expect(b.items[0].imageBase64).toMatch(/^iVBOR/);
  expect(b).not.toHaveProperty("customerData");
});

test("erro do Asaas: rejeita só com status e código, sem chave nem corpo", async () => {
  const f = fetcherCom({ status: 400, corpo: { errors: [{ code: "invalid_object", description: `chave ${CHAVE} cpf 52998224725` }] } });
  const erro = await criarAsaas(CONFIG, f.fetcher).cancelarCheckout("chk-1").then(() => null, (e: unknown) => e);
  expect(erro).toBeInstanceOf(Error);
  const msg = (erro as Error).message;
  expect(msg).toContain("400");
  expect(msg).toContain("invalid_object");
  expect(msg).not.toContain(CHAVE);
  expect(msg).not.toContain("52998224725");
  expect((erro as { status?: number }).status).toBe(400);
});

test("cancelarCheckout e pagamentosDoCheckout", async () => {
  const f = fetcherCom(
    { corpo: { id: "chk-1", status: "CANCELED" } },
    { corpo: { data: [{ id: "pay_1", status: "CONFIRMED", value: 200, netValue: 198.02, externalReference: "res-1",
      split: [{ id: "spl_1", walletId: WALLET, totalValue: 188.12 }] }] } },
  );
  const asaas = criarAsaas(CONFIG, f.fetcher);
  await asaas.cancelarCheckout("chk-1");
  expect(f.chamadas[0].url).toBe("https://api-sandbox.asaas.com/v3/checkouts/chk-1/cancel");
  expect(f.chamadas[0].init.method).toBe("POST");
  expect(await asaas.pagamentosDoCheckout("chk-1")).toEqual([
    { id: "pay_1", status: "CONFIRMED", valorCentavos: 20000, liquidoCentavos: 19802, checkout: null, splits: [{ id: "spl_1", carteira: WALLET, valorCentavos: 18812 }],
      assinatura: null, vencimento: null, link: null },
  ]);
  expect(f.chamadas[1].url).toBe("https://api-sandbox.asaas.com/v3/payments?checkoutSession=chk-1");
});

test("estornar: valor e splits em reais", async () => {
  const f = fetcherCom({ corpo: { id: "pay_1", status: "REFUNDED" } });
  await criarAsaas(CONFIG, f.fetcher).estornar("pay_1", { valorCentavos: 19802, splits: [{ id: "spl_1", valorCentavos: 18812 }], descricao: "Cancelada pelo jogador" });
  expect(f.chamadas[0].url).toBe("https://api-sandbox.asaas.com/v3/payments/pay_1/refund");
  expect(corpo(f.chamadas[0])).toEqual({ value: 198.02, description: "Cancelada pelo jogador", splitRefunds: [{ id: "spl_1", value: 188.12 }] });
});

test("ids vão na URL codificados", async () => {
  const f = fetcherCom({ corpo: {} });
  await criarAsaas(CONFIG, f.fetcher).cancelarCheckout("a/../b?x=1");
  expect(f.chamadas[0].url).toBe("https://api-sandbox.asaas.com/v3/checkouts/a%2F..%2Fb%3Fx%3D1/cancel");
});

test("split sem totalValue: calcula pelo percentual sobre o líquido; pagamento(id) busca uma cobrança", async () => {
  const f = fetcherCom({ corpo: { id: "pay_2", status: "RECEIVED", value: 100, netValue: 99.01, checkoutSession: "chk-9",
    split: [{ id: "spl_2", walletId: WALLET, percentualValue: 95 }] } });
  expect(await criarAsaas(CONFIG, f.fetcher).pagamento("pay_2")).toEqual({
    id: "pay_2", status: "RECEIVED", valorCentavos: 10000, liquidoCentavos: 9901, checkout: "chk-9",
    splits: [{ id: "spl_2", carteira: WALLET, valorCentavos: 9406 }], assinatura: null, vencimento: null, link: null,
  });
  expect(f.chamadas[0].url).toBe("https://api-sandbox.asaas.com/v3/payments/pay_2");
});

test("criarCheckout: link que não é https do Asaas é recusado (o site redireciona para ele)", async () => {
  const pedido = {
    reservaId: "res-1", item: "Quadra 1", descricao: "x", totalCentavos: 20000, carteiraDono: WALLET, percentualDono: 95,
    urlRetorno: "https://x.com/minhas-reservas",
  };
  for (const link of ["https://evil.com/c/1", "http://sandbox.asaas.com/c/1", "https://asaas.com.evil.com/c", "javascript:alert(1)"]) {
    const f = fetcherCom({ corpo: { id: "chk-1", link } });
    await expect(criarAsaas(CONFIG, f.fetcher).criarCheckout(pedido)).rejects.toThrow();
  }
});

// ---------- Mensalidade (assinatura) ----------

test("criarCliente e criarAssinatura: mensal, forma de pagamento à escolha do dono, referência = arena", async () => {
  const f = fetcherCom({ corpo: { id: "cus_1" } }, { corpo: { id: "sub_1", status: "ACTIVE" } });
  const asaas = criarAsaas(CONFIG, f.fetcher);
  expect(await asaas.criarCliente({ nome: "Dono", documento: "24971563792", email: "dono@x.com", arenaId: "arena-1" })).toBe("cus_1");
  expect(f.chamadas[0].url).toBe("https://api-sandbox.asaas.com/v3/customers");
  expect(corpo(f.chamadas[0])).toEqual({
    name: "Dono", cpfCnpj: "24971563792", email: "dono@x.com", externalReference: "arena-1", notificationDisabled: false,
  });
  expect(await asaas.criarAssinatura({
    cliente: "cus_1", valorCentavos: 14990, vencimento: "2026-11-10", descricao: "Mensalidade Replay · Arena Sol", arenaId: "arena-1",
  })).toBe("sub_1");
  expect(f.chamadas[1].url).toBe("https://api-sandbox.asaas.com/v3/subscriptions");
  expect(corpo(f.chamadas[1])).toEqual({
    customer: "cus_1", billingType: "UNDEFINED", value: 149.9, nextDueDate: "2026-11-10", cycle: "MONTHLY",
    description: "Mensalidade Replay · Arena Sol", externalReference: "arena-1",
  });
});

test("alterarAssinatura atualiza as cobranças em aberto; excluirAssinatura usa DELETE", async () => {
  const f = fetcherCom({ corpo: { id: "sub_1" } }, { corpo: { deleted: true } });
  const asaas = criarAsaas(CONFIG, f.fetcher);
  await asaas.alterarAssinatura("sub_1", { valorCentavos: 19900, vencimento: "2026-11-15" });
  expect(f.chamadas[0].url).toBe("https://api-sandbox.asaas.com/v3/subscriptions/sub_1");
  expect(f.chamadas[0].init.method).toBe("PUT");
  expect(corpo(f.chamadas[0])).toEqual({ value: 199, nextDueDate: "2026-11-15", updatePendingPayments: true });
  await asaas.excluirAssinatura("sub_1");
  expect(f.chamadas[1].url).toBe("https://api-sandbox.asaas.com/v3/subscriptions/sub_1");
  expect(f.chamadas[1].init.method).toBe("DELETE");
});

test("cobrança de assinatura: lê assinatura, vencimento e link (só https do Asaas)", async () => {
  const f = fetcherCom(
    { corpo: { id: "pay_3", status: "PENDING", value: 149.9, netValue: 148.91, subscription: "sub_1", dueDate: "2026-11-10",
      invoiceUrl: "https://sandbox.asaas.com/i/abc" } },
    { corpo: { id: "pay_4", status: "PENDING", value: 149.9, subscription: "sub_1", dueDate: "2026-12-10", invoiceUrl: "https://evil.com/i" } },
  );
  const asaas = criarAsaas(CONFIG, f.fetcher);
  expect(await asaas.pagamento("pay_3")).toMatchObject({
    assinatura: "sub_1", vencimento: "2026-11-10", link: "https://sandbox.asaas.com/i/abc", valorCentavos: 14990,
  });
  expect(await asaas.pagamento("pay_4")).toMatchObject({ link: null, vencimento: "2026-12-10" });
});

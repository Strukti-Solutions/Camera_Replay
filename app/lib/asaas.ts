// Cliente mínimo da API do Asaas (Checkout, cobranças do Checkout e estorno).
// A chave fica só no ambiente e nunca aparece em erro nem em log. Spec:
// docs/superpowers/specs/2026-10-26-pagamento-asaas-design.md.

type Ambiente = Record<string, string | undefined>;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type ConfigAsaas = { chave: string; base: string };

export function lerConfigAsaas(env: Ambiente = process.env): ConfigAsaas | null {
  const chave = env.ASAAS_API_KEY?.trim();
  if (!chave) return null;
  const base = env.ASAAS_AMBIENTE?.trim() === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  return { chave, base };
}

export const reaisDeCentavos = (c: number) => Math.round(c) / 100;
const centavosDeReais = (v: unknown) => Math.round(Number(v ?? 0) * 100);

// Imagem obrigatória do item do Checkout: quadrado 64x64 na cor da Strukti.
const IMAGEM_ITEM =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUUlEQVR42u3PQQkAAAgEsCthBkPYv5cRfAuDFViq57UICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICFyBBVQqcGrBaN16AAAAAElFTkSuQmCC";

export class ErroAsaas extends Error {
  constructor(readonly status: number, readonly codigo: string | null) {
    super(`asaas: HTTP ${status}${codigo ? ` (${codigo})` : ""}`);
  }
}

export type PagamentoAsaas = {
  id: string;
  status: string;
  valorCentavos: number;
  liquidoCentavos: number;
  splits: { id: string; carteira: string; valorCentavos: number }[];
};

export type Asaas = {
  criarCheckout(p: {
    reservaId: string; item: string; descricao: string; totalCentavos: number;
    carteiraDono: string; percentualDono: number; urlRetorno: string;
  }): Promise<{ id: string; link: string }>;
  cancelarCheckout(id: string): Promise<void>;
  pagamentosDoCheckout(id: string): Promise<PagamentoAsaas[]>;
  estornar(pagamentoId: string, p: { valorCentavos: number; splits: { id: string; valorCentavos: number }[]; descricao: string }): Promise<void>;
};

export function criarAsaas(config: ConfigAsaas, fetcher: Fetcher = fetch): Asaas {
  async function chamar(metodo: string, caminho: string, corpo?: unknown): Promise<Record<string, unknown>> {
    const r = await fetcher(`${config.base}/${caminho}`, {
      method: metodo,
      headers: { access_token: config.chave, "Content-Type": "application/json", "User-Agent": "replay-strukti" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: "no-store",
    });
    const dados = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
      // Só o código do primeiro erro: a descrição pode repetir dados do pagador.
      const erros = dados?.errors;
      const codigo = Array.isArray(erros) && typeof erros[0]?.code === "string" ? erros[0].code : null;
      throw new ErroAsaas(r.status, codigo);
    }
    return dados;
  }
  const id = (s: string) => encodeURIComponent(s);

  return {
    async criarCheckout(p) {
      const d = await chamar("POST", "checkouts", {
        billingTypes: ["PIX", "CREDIT_CARD"],
        chargeTypes: ["DETACHED"],
        minutesToExpire: 10,
        externalReference: p.reservaId,
        callback: { successUrl: `${p.urlRetorno}?ok=paga`, cancelUrl: p.urlRetorno, expiredUrl: p.urlRetorno },
        items: [{
          name: p.item.slice(0, 30), description: p.descricao.slice(0, 150), quantity: 1,
          value: reaisDeCentavos(p.totalCentavos), imageBase64: IMAGEM_ITEM,
        }],
        // Sem customerData: a página do Asaas pede nome e CPF ao pagador.
        splits: [{ walletId: p.carteiraDono, percentageValue: p.percentualDono }],
      });
      return { id: String(d.id), link: String(d.link) };
    },
    async cancelarCheckout(checkout) {
      await chamar("POST", `checkouts/${id(checkout)}/cancel`);
    },
    async pagamentosDoCheckout(checkout) {
      const d = await chamar("GET", `payments?checkoutSession=${id(checkout)}`);
      const lista = Array.isArray(d.data) ? (d.data as Record<string, unknown>[]) : [];
      return lista.map((p) => ({
        id: String(p.id), status: String(p.status),
        valorCentavos: centavosDeReais(p.value), liquidoCentavos: centavosDeReais(p.netValue),
        splits: (Array.isArray(p.split) ? (p.split as Record<string, unknown>[]) : []).map((s) => ({
          id: String(s.id), carteira: String(s.walletId), valorCentavos: centavosDeReais(s.totalValue),
        })),
      }));
    },
    async estornar(pagamento, p) {
      await chamar("POST", `payments/${id(pagamento)}/refund`, {
        value: reaisDeCentavos(p.valorCentavos),
        description: p.descricao,
        splitRefunds: p.splits.map((s) => ({ id: s.id, value: reaisDeCentavos(s.valorCentavos) })),
      });
    },
  };
}

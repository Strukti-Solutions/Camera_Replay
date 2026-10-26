// Cliente mínimo da API do Asaas (Checkout, cobranças do Checkout, estorno e
// assinatura da mensalidade do dono).
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

// Cliente com a configuração do ambiente; null quando o Asaas não está configurado.
export function asaasDoAmbiente(env: Ambiente = process.env): Asaas | null {
  const config = lerConfigAsaas(env);
  return config ? criarAsaas(config) : null;
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
  checkout: string | null; // checkoutSession, quando a cobrança veio de um Checkout
  splits: { id: string; carteira: string; valorCentavos: number }[];
  assinatura: string | null; // id da assinatura, quando é cobrança de mensalidade
  vencimento: string | null; // AAAA-MM-DD
  link: string | null; // fatura do Asaas (só https do próprio Asaas)
};

export type Asaas = {
  criarCheckout(p: {
    reservaId: string; item: string; descricao: string; totalCentavos: number;
    carteiraDono: string; percentualDono: number; urlRetorno: string;
  }): Promise<{ id: string; link: string }>;
  cancelarCheckout(id: string): Promise<void>;
  pagamentosDoCheckout(id: string): Promise<PagamentoAsaas[]>;
  pagamento(id: string): Promise<PagamentoAsaas>;
  estornar(pagamentoId: string, p: { valorCentavos: number; splits: { id: string; valorCentavos: number }[]; descricao: string }): Promise<void>;
  // Mensalidade do dono: cliente e assinatura na conta da Strukti.
  criarCliente(p: { nome: string; documento: string; email: string; arenaId: string }): Promise<string>;
  criarAssinatura(p: { cliente: string; valorCentavos: number; vencimento: string; descricao: string; arenaId: string }): Promise<string>;
  alterarAssinatura(id: string, p: { valorCentavos: number; vencimento: string }): Promise<void>;
  excluirAssinatura(id: string): Promise<void>;
};

// Link que o site mostra ou para onde redireciona: só https do próprio Asaas.
export function linkDoAsaas(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    const host = u.hostname;
    return u.protocol === "https:" && (host === "asaas.com" || host.endsWith(".asaas.com")) ? v : null;
  } catch {
    return null;
  }
}

// Cobrança como o Asaas devolve. O valor de cada split vem em totalValue; se
// vier só o percentual, é calculado sobre o líquido (como o Asaas faz).
function lerPagamento(p: Record<string, unknown>): PagamentoAsaas {
  const liquido = centavosDeReais(p.netValue);
  return {
    id: String(p.id), status: String(p.status),
    valorCentavos: centavosDeReais(p.value), liquidoCentavos: liquido,
    checkout: typeof p.checkoutSession === "string" ? p.checkoutSession : null,
    assinatura: typeof p.subscription === "string" ? p.subscription : null,
    vencimento: typeof p.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? p.dueDate : null,
    link: linkDoAsaas(p.invoiceUrl),
    splits: (Array.isArray(p.split) ? (p.split as Record<string, unknown>[]) : []).map((s) => {
      const percentual = Number(s.percentualValue ?? s.percentageValue ?? 0);
      return {
        id: String(s.id), carteira: String(s.walletId),
        valorCentavos: s.totalValue != null ? centavosDeReais(s.totalValue)
          : s.fixedValue != null ? centavosDeReais(s.fixedValue)
          : Math.round((liquido * percentual) / 100),
      };
    }),
  };
}

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
      // O site redireciona o jogador para este link: só https do próprio Asaas.
      const link = linkDoAsaas(d.link);
      if (!link) throw new ErroAsaas(502, "link_inesperado");
      return { id: String(d.id), link };
    },
    async cancelarCheckout(checkout) {
      await chamar("POST", `checkouts/${id(checkout)}/cancel`);
    },
    async pagamentosDoCheckout(checkout) {
      const d = await chamar("GET", `payments?checkoutSession=${id(checkout)}`);
      const lista = Array.isArray(d.data) ? (d.data as Record<string, unknown>[]) : [];
      return lista.map(lerPagamento);
    },
    async pagamento(pagamento) {
      return lerPagamento(await chamar("GET", `payments/${id(pagamento)}`));
    },
    async estornar(pagamento, p) {
      await chamar("POST", `payments/${id(pagamento)}/refund`, {
        value: reaisDeCentavos(p.valorCentavos),
        description: p.descricao,
        splitRefunds: p.splits.map((s) => ({ id: s.id, value: reaisDeCentavos(s.valorCentavos) })),
      });
    },
    async criarCliente(p) {
      const d = await chamar("POST", "customers", {
        name: p.nome, cpfCnpj: p.documento, email: p.email, externalReference: p.arenaId, notificationDisabled: false,
      });
      return String(d.id);
    },
    async criarAssinatura(p) {
      // UNDEFINED: o dono escolhe Pix, boleto ou cartão na fatura.
      const d = await chamar("POST", "subscriptions", {
        customer: p.cliente, billingType: "UNDEFINED", value: reaisDeCentavos(p.valorCentavos), nextDueDate: p.vencimento,
        cycle: "MONTHLY", description: p.descricao, externalReference: p.arenaId,
      });
      return String(d.id);
    },
    async alterarAssinatura(assinatura, p) {
      await chamar("PUT", `subscriptions/${id(assinatura)}`, {
        value: reaisDeCentavos(p.valorCentavos), nextDueDate: p.vencimento, updatePendingPayments: true,
      });
    },
    async excluirAssinatura(assinatura) {
      await chamar("DELETE", `subscriptions/${id(assinatura)}`);
    },
  };
}

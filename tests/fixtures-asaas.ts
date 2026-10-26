import { vi } from "vitest";
import type { Asaas, PagamentoAsaas } from "../app/lib/asaas";
import type { Db } from "../app/lib/db";
import { criarContaJogador } from "../app/lib/jogadores";
import { criarArena, criarHorariosDeHora, criarQuadra } from "./fixtures";

export const WALLET = "0f0e8c2a-6c4e-4c4c-9a3c-1b2d3e4f5a6b";

// Arena com quadra de horários de 1 h (7h–23h, R$ 100,00) e uma jogadora; com
// carteira Asaas e taxa de 5% por padrão.
export async function arenaOnline(db: Db, comCarteira = true) {
  const arena = await criarArena(db, "Arena Sol");
  if (comCarteira) await db.query("update arenas set asaas_wallet_id = $2, taxa_percentual = 5 where id = $1", [arena.id, WALLET]);
  const quadra = await criarQuadra(db, arena.id);
  await criarHorariosDeHora(db, arena.id, quadra.id, [0, 1, 2, 3, 4, 5, 6], 7, 23, 10000);
  const c = await criarContaJogador(db, { nome: "Ana", email: "ana@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!c.ok) throw new Error("conta");
  return { arena, quadra, jogadorId: c.jogadorId };
}

// Asaas falso: guarda os Checkouts criados e os estornos; `pagamentos` é o que
// a API devolveria para cada Checkout (e por id).
export function asaasFalso(falhar = false, pagamentos: Record<string, PagamentoAsaas[]> = {}) {
  const estornos: { pagamento: string; valorCentavos: number; splits: { id: string; valorCentavos: number }[] }[] = [];
  const checkouts: Parameters<Asaas["criarCheckout"]>[0][] = [];
  let assinaturas = 0;
  const asaas: Asaas = {
    criarCheckout: vi.fn(async (p) => {
      if (falhar) throw new Error("asaas: HTTP 500");
      checkouts.push(p);
      return { id: `chk-${checkouts.length}`, link: `https://sandbox.asaas.com/c/chk-${checkouts.length}` };
    }),
    cancelarCheckout: vi.fn(async () => {}),
    pagamentosDoCheckout: vi.fn(async (id: string) => pagamentos[id] ?? []),
    pagamento: vi.fn(async (id: string) => {
      const p = Object.values(pagamentos).flat().find((x) => x.id === id);
      if (!p) throw new Error("asaas: HTTP 404");
      return p;
    }),
    estornar: vi.fn(async (pagamento: string, p: { valorCentavos: number; splits: { id: string; valorCentavos: number }[] }) => {
      if (falhar) throw new Error("asaas: HTTP 400 (insufficient_balance)");
      estornos.push({ pagamento, valorCentavos: p.valorCentavos, splits: p.splits });
    }),
    criarCliente: vi.fn(async () => {
      if (falhar) throw new Error("asaas: HTTP 400 (invalid_cpfCnpj)");
      return "cus_1";
    }),
    criarAssinatura: vi.fn(async () => `sub_${++assinaturas}`),
    lerAssinatura: vi.fn(async () => ({ proximoVencimento: "2026-12-10" })),
    alterarAssinatura: vi.fn(async () => {}),
    excluirAssinatura: vi.fn(async () => {}),
  };
  return { asaas, checkouts, estornos };
}


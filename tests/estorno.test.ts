import { expect, test, vi } from "vitest";
import { ErroAsaas, type PagamentoAsaas } from "../app/lib/asaas";
import type { Db } from "../app/lib/db";
import { abrirPagamento, estornarAposCancelar, processarEventoAsaas } from "../app/lib/pagamentos";
import { cancelarPeloDono, cancelarPeloJogador, criarReserva } from "../app/lib/reservas";
import { novoBanco } from "./db";
import { arenaOnline, asaasFalso, WALLET } from "./fixtures-asaas";

const AGORA = new Date("2026-11-09T10:00:00-03:00");
const DIA = "2026-11-10";
const APP = "https://replay.exemplo";
const PAGO: PagamentoAsaas = {
  id: "pay_1", status: "CONFIRMED", valorCentavos: 20000, liquidoCentavos: 19802, checkout: "chk-1",
  splits: [{ id: "spl_1", carteira: WALLET, valorCentavos: 18812 }],
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

test("dono cancela reserva paga: volta tudo, o dono devolve o split mais a tarifa", async () => {
  const { db, arena, reservaId, f } = await paga();
  expect(await cancelarPeloDono(db, arena.id, reservaId, "Chuva", AGORA)).toBe(true);
  expect(await estornarAposCancelar(db, f.asaas, reservaId)).toBe("solicitado");
  expect(f.estornos).toEqual([{ pagamento: "pay_1", valorCentavos: 20000, splits: [{ id: "spl_1", valorCentavos: 18812 + 198 }] }]);
  expect(await reserva(db, reservaId)).toMatchObject({ estorno: "solicitado", estorno_centavos: 20000 });
});

test("dono cancela e o Asaas recusa tirar do dono mais que o split: tenta de novo com o split só", async () => {
  const { db, arena, reservaId, f } = await paga();
  const chamadas: number[] = [];
  f.asaas.estornar = vi.fn(async (_p: string, e: { splits: { valorCentavos: number }[] }) => {
    chamadas.push(e.splits[0].valorCentavos);
    if (chamadas.length === 1) throw new ErroAsaas(400, "invalid_action");
  });
  await cancelarPeloDono(db, arena.id, reservaId, "", AGORA);
  expect(await estornarAposCancelar(db, f.asaas, reservaId)).toBe("solicitado");
  expect(chamadas).toEqual([18812 + 198, 18812]);
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

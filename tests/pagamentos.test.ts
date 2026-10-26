import { expect, test, vi } from "vitest";
import type { Db } from "../app/lib/db";
import { criarContaJogador } from "../app/lib/jogadores";
import { abrirPagamento, quadraCobraOnline } from "../app/lib/pagamentos";
import { criarReserva, periodosOcupados } from "../app/lib/reservas";
import { novoBanco } from "./db";
import { arenaOnline, asaasFalso, WALLET } from "./fixtures-asaas";

// Segunda, 09/11/2026, 10h em São Paulo. Reservas em 10/11 (terça).
const AGORA = new Date("2026-11-09T10:00:00-03:00");
const DIA = "2026-11-10";
const APP = "https://replay.exemplo";

const reserva = (db: Db, id: string) =>
  db.query<Record<string, unknown>>("select * from reservas where id = $1", [id]).then((r) => r.rows[0]);

test("online numa arena com carteira: segurada por 10 min, pagamento online e taxa estimada", async () => {
  const db = await novoBanco();
  const { quadra, jogadorId } = await arenaOnline(db);
  const r = await criarReserva(db, jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 2 }, AGORA, { online: true });
  expect(r).toMatchObject({ ok: true, pagarOnline: true });
  if (!r.ok) throw new Error();
  const l = await reserva(db, r.reservaId);
  expect(l).toMatchObject({ situacao: "segurada", pagamento: "online", total_centavos: 20000, taxa_centavos: 1000 });
  expect((l.segura_ate as Date).getTime()).toBe(AGORA.getTime() + 10 * 60_000);
});

test("sem carteira, ou com o Asaas desligado: continua confirmada na hora, pagar na arena", async () => {
  const db = await novoBanco();
  const sem = await arenaOnline(db, false);
  const r1 = await criarReserva(db, sem.jogadorId, { quadraId: sem.quadra.id, dia: DIA, inicio: 8 * 60, qtd: 1 }, AGORA, { online: true });
  expect(r1).toMatchObject({ ok: true, pagarOnline: false });
  if (!r1.ok) throw new Error();
  expect(await reserva(db, r1.reservaId)).toMatchObject({ situacao: "confirmada", pagamento: "arena", taxa_centavos: 0 });

  const db2 = await novoBanco();
  const com = await arenaOnline(db2);
  const r2 = await criarReserva(db2, com.jogadorId, { quadraId: com.quadra.id, dia: DIA, inicio: 8 * 60, qtd: 1 }, AGORA);
  expect(r2).toMatchObject({ ok: true, pagarOnline: false });
});

test("segurada no prazo conta no limite de reservas e ocupa o horário", async () => {
  const db = await novoBanco();
  const { quadra, jogadorId } = await arenaOnline(db);
  for (const h of [8, 9]) {
    expect((await criarReserva(db, jogadorId, { quadraId: quadra.id, dia: DIA, inicio: h * 60, qtd: 1 }, AGORA, { online: true })).ok).toBe(true);
  }
  const terceira = await criarReserva(db, jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 11 * 60, qtd: 1 }, AGORA, { online: true });
  expect(terceira.ok).toBe(false);
  expect((await periodosOcupados(db, (await db.query<{ arena_id: string }>("select arena_id from reservas limit 1")).rows[0].arena_id, quadra.id, DIA)).length).toBe(2);
});

test("abrirPagamento: cria o Checkout com split do dono e grava id e link", async () => {
  const db = await novoBanco();
  const { quadra, jogadorId } = await arenaOnline(db);
  const r = await criarReserva(db, jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 2 }, AGORA, { online: true });
  if (!r.ok) throw new Error();
  const f = asaasFalso();
  expect(await abrirPagamento(db, f.asaas, jogadorId, r.reservaId, APP)).toEqual({ ok: true, link: "https://sandbox.asaas.com/c/chk-1" });
  expect(f.checkouts[0]).toEqual({
    reservaId: r.reservaId, item: "Quadra 1", descricao: "Arena Sol · Terça-feira, 10 de novembro · 18h às 20h",
    totalCentavos: 20000, carteiraDono: WALLET, percentualDono: 95, urlRetorno: `${APP}/minhas-reservas`,
  });
  expect(await reserva(db, r.reservaId)).toMatchObject({ asaas_checkout_id: "chk-1", asaas_checkout_link: "https://sandbox.asaas.com/c/chk-1" });
  // Segunda chamada (o jogador volta para pagar): reaproveita o mesmo Checkout.
  expect(await abrirPagamento(db, f.asaas, jogadorId, r.reservaId, APP)).toEqual({ ok: true, link: "https://sandbox.asaas.com/c/chk-1" });
  expect(f.checkouts).toHaveLength(1);
});

test("abrirPagamento: falha no Asaas desfaz a segurada e libera o horário; reserva de outro jogador é recusada", async () => {
  const db = await novoBanco();
  const { arena, quadra, jogadorId } = await arenaOnline(db);
  const r = await criarReserva(db, jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 1 }, AGORA, { online: true });
  if (!r.ok) throw new Error();
  const outro = await criarContaJogador(db, { nome: "Bia", email: "bia@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!outro.ok) throw new Error();
  expect(await abrirPagamento(db, asaasFalso().asaas, outro.jogadorId, r.reservaId, APP)).toEqual({ ok: false });

  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await abrirPagamento(db, asaasFalso(true).asaas, jogadorId, r.reservaId, APP)).toEqual({ ok: false });
  erro.mockRestore();
  expect(await reserva(db, r.reservaId)).toMatchObject({ situacao: "expirada" });
  expect(await periodosOcupados(db, arena.id, quadra.id, DIA)).toEqual([]);
});

test("abrirPagamento: reserva já confirmada ou fora do prazo não abre Checkout", async () => {
  const db = await novoBanco();
  const { quadra, jogadorId } = await arenaOnline(db);
  const r = await criarReserva(db, jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 1 }, AGORA, { online: true });
  if (!r.ok) throw new Error();
  await db.query("update reservas set segura_ate = now() - interval '1 minute' where id = $1", [r.reservaId]);
  const f = asaasFalso();
  expect(await abrirPagamento(db, f.asaas, jogadorId, r.reservaId, APP)).toEqual({ ok: false });
  expect(f.checkouts).toHaveLength(0);
});

test("quadraCobraOnline: só com carteira; id inválido é false", async () => {
  const db = await novoBanco();
  const com = await arenaOnline(db);
  expect(await quadraCobraOnline(db, com.quadra.id)).toBe(true);
  await db.query("update arenas set asaas_wallet_id = null");
  expect(await quadraCobraOnline(db, com.quadra.id)).toBe(false);
  expect(await quadraCobraOnline(db, "lixo")).toBe(false);
});

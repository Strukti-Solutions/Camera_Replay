import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena, criarQuadra } from "./fixtures";
import { hashSenha } from "../app/lib/senha";
import {
  criarArenaAdmin, criarSuperAdmin, definirCarteiraAsaas, definirStatusArena, definirTaxaArena, detalheArenaAdmin, listarArenasAdmin,
  marcarEstornoResolvido, pendenciasDePagamento,
} from "../app/lib/plataforma";
import { listarArenasPublicas } from "../app/lib/arenas-publicas";
import { entrarUnico } from "../app/lib/entrar-unico";

test("migração: status só aceita ativa/suspensa; super admin com e-mail minúsculo e único", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await expect(db.query("update arenas set status_assinatura = 'cancelada' where id = $1", [a.id])).rejects.toThrow();
  await expect(db.query("insert into super_admins (email, senha_hash) values ('A@x.com', 'h')")).rejects.toThrow();
  await db.query("insert into super_admins (email, senha_hash) values ('a@x.com', 'h')");
  await expect(db.query("insert into super_admins (email, senha_hash) values ('a@x.com', 'h')")).rejects.toThrow();
});

test("listarArenasPublicas: só ativas, por nome, nome, slug e cidade", async () => {
  const db = await novoBanco();
  const z = await criarArena(db, "Zeta");
  const a = await criarArena(db, "Alfa");
  const s = await criarArena(db, "Suspensa");
  await definirStatusArena(db, s.id, "suspensa");
  const r = await listarArenasPublicas(db);
  expect(r).toEqual([{ nome: "Alfa", slug: a.slug, cidade: null }, { nome: "Zeta", slug: z.slug, cidade: null }]);
  expect(Object.keys(r[0]).sort()).toEqual(["cidade", "nome", "slug"]);
});

test("listarArenasPublicas: busca por nome ignora caixa, trata % e _ como texto e limita a 50", async () => {
  const db = await novoBanco();
  await criarArena(db, "Arena Beira Mar");
  await criarArena(db, "Quadra 100%");
  expect((await listarArenasPublicas(db, "  beira ")).map((x) => x.nome)).toEqual(["Arena Beira Mar"]);
  expect((await listarArenasPublicas(db, "%")).map((x) => x.nome)).toEqual(["Quadra 100%"]);
  expect(await listarArenasPublicas(db, "_")).toEqual([]);
  expect(await listarArenasPublicas(db, "nada")).toEqual([]);
  for (let i = 0; i < 55; i++) await criarArena(db, `Muitas ${String(i).padStart(2, "0")}`);
  expect(await listarArenasPublicas(db)).toHaveLength(50);
});

test("criarArenaAdmin cria arena e dono; e-mail repetido dá erro claro e não cria nada", async () => {
  const db = await novoBanco();
  const r = await criarArenaAdmin(db, { arena: "Nova", email: "Dono@X.com", senha: "senha-longa-1" });
  expect(r.arenaId).toBeTruthy();
  await expect(criarArenaAdmin(db, { arena: "Outra", email: "dono@x.com", senha: "senha-longa-1" }))
    .rejects.toThrow("e-mail já cadastrado");
  expect((await db.query("select 1 from arenas")).rows).toHaveLength(1);
  expect((await db.query("select 1 from usuarios")).rows).toHaveLength(1);
});

test("listarArenasAdmin: contagens por arena, dono, status e sem segredos", async () => {
  const db = await novoBanco();
  const a = await criarArenaAdmin(db, { arena: "Arena A", email: "a@x.com", senha: "senha-longa-1" });
  const b = await criarArenaAdmin(db, { arena: "Arena B", email: "b@x.com", senha: "senha-longa-1" });
  await criarQuadra(db, a.arenaId);
  await criarQuadra(db, a.arenaId);
  await definirStatusArena(db, b.arenaId, "suspensa");
  const l = await listarArenasAdmin(db);
  expect(l).toHaveLength(2);
  const la = l.find((x) => x.id === a.arenaId)!, lb = l.find((x) => x.id === b.arenaId)!;
  expect(la).toMatchObject({ nome: "Arena A", status: "ativa", quadras: 2, donoEmail: "a@x.com" });
  expect(lb).toMatchObject({ nome: "Arena B", status: "suspensa", quadras: 0, donoEmail: "b@x.com" });
  expect(la.criadoEm).toBeInstanceOf(Date);
  expect(JSON.stringify(l)).not.toMatch(/senha|hash|scrypt/);
});

test("definirStatusArena: true se existe, false para id inexistente/malformado/status inválido", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  expect(await definirStatusArena(db, a.id, "suspensa")).toBe(true);
  expect(await definirStatusArena(db, a.id, "ativa")).toBe(true);
  expect(await definirStatusArena(db, "00000000-0000-0000-0000-000000000000", "suspensa")).toBe(false);
  expect(await definirStatusArena(db, "lixo", "suspensa")).toBe(false);
  expect(await definirStatusArena(db, a.id, "qualquer" as never)).toBe(false);
  expect((await db.query("select status_assinatura from arenas")).rows).toEqual([{ status_assinatura: "ativa" }]);
});

test("definirStatusArena: suspender apaga as sessões de dono só dessa arena; reativar não as devolve", async () => {
  const db = await novoBanco();
  const a = await criarArenaAdmin(db, { arena: "Arena A", email: "a@x.com", senha: "senha-boa-1" });
  const b = await criarArenaAdmin(db, { arena: "Arena B", email: "b@x.com", senha: "senha-boa-1" });
  for (const x of [a, b]) {
    await db.query(
      "insert into sessoes (arena_id, usuario_id, token_hash, expira_em) values ($1, $2, $3, now() + interval '1 day')",
      [x.arenaId, x.usuarioId, `dono-${x.arenaId}`],
    );
  }
  await definirStatusArena(db, a.arenaId, "suspensa");
  const resta = async (t: string) => (await db.query(`select arena_id from ${t}`)).rows.map((r) => r.arena_id);
  expect(await resta("sessoes")).toEqual([b.arenaId]);
  await definirStatusArena(db, a.arenaId, "ativa");
  expect(await resta("sessoes")).toEqual([b.arenaId]);
});

test("criarSuperAdmin: senha >= 12, e-mail normalizado e único, hash scrypt", async () => {
  const db = await novoBanco();
  await expect(criarSuperAdmin(db, { email: "a@x.com", senha: "curta-11-ch" })).rejects.toThrow(/senha/);
  const r = await criarSuperAdmin(db, { email: " Admin@X.com ", senha: "senha-bem-longa" });
  expect(r.id).toBeTruthy();
  const q = await db.query<{ email: string; senha_hash: string }>("select email, senha_hash from super_admins");
  expect(q.rows[0].email).toBe("admin@x.com");
  expect(q.rows[0].senha_hash).toMatch(/^scrypt\$/);
  await expect(criarSuperAdmin(db, { email: "admin@x.com", senha: "senha-bem-longa" })).rejects.toThrow("e-mail já cadastrado");
  expect(await entrarUnico(db, "admin@x.com", "senha-bem-longa", "1.1.1.1")).toMatchObject({ ok: true, tipo: "admin" });
});

test("e-mail de super admin não pode coincidir com o de dono (um e-mail, uma conta)", async () => {
  const db = await novoBanco();
  const arena = await criarArena(db);
  await db.query("insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'x@x.com', $2, 'dono')", [arena.id, await hashSenha("senha-do-dono-1")]);
  await expect(criarSuperAdmin(db, { email: "x@x.com", senha: "senha-bem-longa" })).rejects.toThrow("e-mail já cadastrado");
});

test("listarArenasPublicas: busca com caractere NUL não quebra a consulta (o NUL é descartado)", async () => {
  const db = await novoBanco();
  await criarArena(db, "Arena Beira Mar");
  expect((await listarArenasPublicas(db, "Bei\u0000ra")).map((x) => x.nome)).toEqual(["Arena Beira Mar"]);
  expect(await listarArenasPublicas(db, "\u0000")).toHaveLength(1);
});

test("detalheArenaAdmin devolve taxa e e-mail do dono; malformado não consulta", async () => {
  const db = await novoBanco();
  const { arenaId } = await criarArenaAdmin(db, { arena: "Arena X", email: "dono@x.com", senha: "umasenhalonga1" });
  const d = await detalheArenaAdmin(db, arenaId);
  expect(d).toMatchObject({ id: arenaId, nome: "Arena X", status: "ativa", taxaPercentual: 5, donoEmail: "dono@x.com" });
  expect(d?.slug).toBeTruthy();
  expect(await detalheArenaAdmin(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  const espiao = { query: async () => { throw new Error("não devia consultar"); } };
  expect(await detalheArenaAdmin(espiao as never, "malformado")).toBeNull();
});

test("definirTaxaArena aceita 0, 7,5 e 30 e recusa -1, 30,01 e 7,555", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  for (const v of [0, 7.5, 30]) {
    expect(await definirTaxaArena(db, a.id, v)).toBe(true);
    expect((await detalheArenaAdmin(db, a.id))?.taxaPercentual).toBe(v);
  }
  for (const v of [-1, 30.01, 7.555, Number.NaN]) {
    expect(await definirTaxaArena(db, a.id, v)).toBe(false);
  }
  expect((await detalheArenaAdmin(db, a.id))?.taxaPercentual).toBe(30);
  expect(await definirTaxaArena(db, "00000000-0000-4000-8000-000000000000", 5)).toBe(false);
  expect(await definirTaxaArena(db, "x", 5)).toBe(false);
});

test("definirCarteiraAsaas: aceita walletId (uuid), em branco desvincula; lixo e arena inexistente recusam", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  expect((await detalheArenaAdmin(db, a.id))?.carteiraAsaas).toBeNull();
  const w = "0F0E8C2A-6C4E-4C4C-9A3C-1B2D3E4F5A6B";
  expect(await definirCarteiraAsaas(db, a.id, ` ${w} `)).toBe(true);
  expect((await detalheArenaAdmin(db, a.id))?.carteiraAsaas).toBe(w.toLowerCase());
  expect(await definirCarteiraAsaas(db, a.id, "lixo")).toBe(false);
  expect((await detalheArenaAdmin(db, a.id))?.carteiraAsaas).toBe(w.toLowerCase());
  expect(await definirCarteiraAsaas(db, a.id, "")).toBe(true);
  expect((await detalheArenaAdmin(db, a.id))?.carteiraAsaas).toBeNull();
  expect(await definirCarteiraAsaas(db, "00000000-0000-4000-8000-000000000000", w)).toBe(false);
});

test("pendências de pagamento: estornos pendentes e eventos do webhook com erro; marcar resolvido", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena Sol");
  const q = await criarQuadra(db, a.id);
  const j = await db.query<{ id: string }>("insert into jogadores (nome, email, senha_hash, termos_versao) values ('Ana', 'ana@x.com', 'h', 'v1') returning id");
  const r = await db.query<{ id: string }>(
    `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim, pagamento, total_centavos, taxa_centavos, detalhe,
                           asaas_pagamento_id, pago_centavos, estorno, cancelada_por)
     values ($1, $2, $3, 'reserva', 'cancelada', '2026-11-10T21:00:00Z', '2026-11-10T22:00:00Z', 'online', 10000, 500, '[]',
             'pay_1', 10000, 'pendente', 'dono') returning id`,
    [a.id, q.id, j.rows[0].id],
  );
  await db.query("insert into asaas_eventos (id, tipo, payload, erro) values ('evt_1', 'CHECKOUT_PAID', '{}', 'reserva não encontrada')");
  await db.query("insert into asaas_eventos (id, tipo, payload) values ('evt_2', 'CHECKOUT_PAID', '{}')");
  const p = await pendenciasDePagamento(db);
  expect(p.estornos).toEqual([{
    reservaId: r.rows[0].id, arena: "Arena Sol", jogador: "Ana", pagamentoId: "pay_1", pagoCentavos: 10000,
    inicio: new Date("2026-11-10T21:00:00Z"), canceladaPor: "dono",
  }]);
  expect(p.eventos.map((e) => [e.id, e.tipo, e.erro])).toEqual([["evt_1", "CHECKOUT_PAID", "reserva não encontrada"]]);
  expect(await marcarEstornoResolvido(db, r.rows[0].id)).toBe(true);
  expect(await marcarEstornoResolvido(db, r.rows[0].id)).toBe(false);
  expect((await pendenciasDePagamento(db)).estornos).toEqual([]);
  expect(await marcarEstornoResolvido(db, "lixo")).toBe(false);
});

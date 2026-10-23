import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena, criarQuadra } from "./fixtures";
import { hashSenha } from "../app/lib/senha";
import {
  criarArenaAdmin, criarSuperAdmin, definirStatusArena, listarArenasAdmin,
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

test("listarArenasPublicas: só ativas, por nome, só nome e slug", async () => {
  const db = await novoBanco();
  const z = await criarArena(db, "Zeta");
  const a = await criarArena(db, "Alfa");
  const s = await criarArena(db, "Suspensa");
  await definirStatusArena(db, s.id, "suspensa");
  const r = await listarArenasPublicas(db);
  expect(r).toEqual([{ nome: "Alfa", slug: a.slug }, { nome: "Zeta", slug: z.slug }]);
  expect(Object.keys(r[0]).sort()).toEqual(["nome", "slug"]);
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

import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena } from "./fixtures";
import { hashSenha } from "../app/lib/senha";
import { criarSessaoDono, validarSessao } from "../app/lib/sessao";
import { criarSessaoAdmin, sairAdmin, validarSessaoAdmin } from "../app/lib/sessao-admin";
import type { Db } from "../app/lib/db";

// Login (senha, limites) fica em entrar-unico.test.ts; aqui, a sessão do admin.

const SENHA = "senha-do-admin-12";

async function preparar() {
  const db = await novoBanco();
  const r = await db.query<{ id: string }>(
    "insert into super_admins (email, senha_hash) values ('admin@strukti.com', $1) returning id",
    [await hashSenha(SENHA)],
  );
  return { db, adminId: r.rows[0].id };
}

test("criarSessaoAdmin: sessão de 12 h que valida e sai", async () => {
  const { db, adminId } = await preparar();
  const r = await criarSessaoAdmin(db, adminId);
  const horas = (r.expiraEm.getTime() - Date.now()) / 3600_000;
  expect(horas).toBeGreaterThan(11.9);
  expect(horas).toBeLessThanOrEqual(12.01);
  expect(await validarSessaoAdmin(db, r.token)).toEqual({ adminId, email: "admin@strukti.com" });
  await sairAdmin(db, r.token);
  expect(await validarSessaoAdmin(db, r.token)).toBeNull();
  await expect(sairAdmin(db, "abc")).resolves.toBeUndefined();
});

test("sessão de admin não vale como de dono, e vice-versa", async () => {
  const { db, adminId } = await preparar();
  const arena = await criarArena(db, "Arena");
  const u = await db.query<{ id: string }>(
    "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'dono@x.com', $2, 'dono') returning id",
    [arena.id, await hashSenha(SENHA)],
  );
  const adm = await criarSessaoAdmin(db, adminId);
  const dono = await criarSessaoDono(db, u.rows[0].id, arena.id);
  expect(await validarSessao(db, adm.token)).toBeNull();
  expect(await validarSessaoAdmin(db, dono.token)).toBeNull();
});

test("dono não pode ter o e-mail do admin (um e-mail, uma conta)", async () => {
  const { db } = await preparar();
  const arena = await criarArena(db, "Arena");
  await expect(
    db.query(
      "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'admin@strukti.com', $2, 'dono')",
      [arena.id, await hashSenha("outra-senha-dono")],
    ),
  ).rejects.toThrow();
});

test("o banco guarda só o hash do token; vencida e malformada dão null sem tocar o banco", async () => {
  const { db, adminId } = await preparar();
  const r = await criarSessaoAdmin(db, adminId);
  const h = await db.query<{ token_hash: string }>("select token_hash from sessoes_admin");
  expect(h.rows[0].token_hash).not.toContain(r.token);
  await db.query("update sessoes_admin set expira_em = now() - interval '1 second'");
  expect(await validarSessaoAdmin(db, r.token)).toBeNull();
  const falso = { query: () => { throw new Error("tocou no banco"); } } as unknown as Db;
  expect(await validarSessaoAdmin(falso, "abc")).toBeNull();
  await expect(sairAdmin(falso, "abc")).resolves.toBeUndefined();
});

test("cada sessão nova apaga as sessões vencidas", async () => {
  const { db, adminId } = await preparar();
  await criarSessaoAdmin(db, adminId);
  await db.query("update sessoes_admin set expira_em = now() - interval '1 hour'");
  await criarSessaoAdmin(db, adminId);
  expect((await db.query("select 1 from sessoes_admin")).rows).toHaveLength(1);
});

test("apagar o super admin apaga as sessões dele", async () => {
  const { db, adminId } = await preparar();
  await criarSessaoAdmin(db, adminId);
  await db.query("delete from super_admins");
  expect((await db.query("select 1 from sessoes_admin")).rows).toHaveLength(0);
});

import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena } from "./fixtures";
import { hashSenha } from "../app/lib/senha";
import { entrar, validarSessao } from "../app/lib/sessao";
import { entrarAdmin, sairAdmin, validarSessaoAdmin } from "../app/lib/sessao-admin";
import type { Db } from "../app/lib/db";

const SENHA = "senha-do-admin-12";

async function preparar() {
  const db = await novoBanco();
  await db.query("insert into super_admins (email, senha_hash) values ('admin@strukti.com', $1)", [await hashSenha(SENHA)]);
  return db;
}

async function falhas(db: Db, chave: string, ip: string, n: number) {
  for (let i = 0; i < n; i++) await db.query("insert into tentativas_login (email, ip) values ($1, $2)", [chave, ip]);
}

test("admin entra, valida (e-mail normalizado), sessão de 12 h, e sai", async () => {
  const db = await preparar();
  const r = await entrarAdmin(db, "  Admin@Strukti.com ", SENHA, "1.1.1.1");
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const horas = (r.expiraEm.getTime() - Date.now()) / 3600_000;
  expect(horas).toBeGreaterThan(11.9);
  expect(horas).toBeLessThanOrEqual(12.01);
  expect(await validarSessaoAdmin(db, r.token)).toMatchObject({ email: "admin@strukti.com" });
  await sairAdmin(db, r.token);
  expect(await validarSessaoAdmin(db, r.token)).toBeNull();
  await expect(sairAdmin(db, "abc")).resolves.toBeUndefined();
});

test("senha errada e e-mail inexistente dão a mesma resposta", async () => {
  const db = await preparar();
  const a = await entrarAdmin(db, "admin@strukti.com", "errada", "1.1.1.1");
  const b = await entrarAdmin(db, "nao@strukti.com", "errada", "1.1.1.1");
  expect(a).toEqual({ ok: false, motivo: "credenciais" });
  expect(b).toEqual(a);
});

test("mesmo limite do dono: 5 por e-mail e 20 por IP, 15 min; chave admin:<email>", async () => {
  const db = await preparar();
  await falhas(db, "admin:admin@strukti.com", "2.2.2.2", 5);
  expect(await entrarAdmin(db, "admin@strukti.com", SENHA, "3.3.3.3")).toEqual({ ok: false, motivo: "bloqueado" });
  await db.query("update tentativas_login set em = now() - interval '16 minutes'");
  expect((await entrarAdmin(db, "admin@strukti.com", SENHA, "3.3.3.3")).ok).toBe(true);

  const db2 = await preparar();
  for (let i = 0; i < 20; i++) await falhas(db2, `admin:u${i}@x.com`, "9.9.9.9", 1);
  expect(await entrarAdmin(db2, "admin@strukti.com", SENHA, "9.9.9.9")).toEqual({ ok: false, motivo: "bloqueado" });
  expect((await entrarAdmin(db2, "admin@strukti.com", SENHA, "8.8.8.8")).ok).toBe(true);

  await entrarAdmin(db2, "x@strukti.com", "errada", "7.7.7.7");
  const k = await db2.query<{ email: string }>("select email from tentativas_login where ip = '7.7.7.7'");
  expect(k.rows).toEqual([{ email: "admin:x@strukti.com" }]);
});

test("limite por IP é por tipo: falhas de dono e de admin não bloqueiam o outro tipo", async () => {
  const db = await preparar();
  const arena = await criarArena(db, "Arena");
  await db.query("insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'dono@x.com', $2, 'dono')", [arena.id, await hashSenha(SENHA)]);

  // 20 falhas de dono não bloqueiam admin
  for (let i = 0; i < 20; i++) await falhas(db, `dono:u${i}@x.com`, "6.6.6.6", 1);
  expect((await entrarAdmin(db, "admin@strukti.com", SENHA, "6.6.6.6")).ok).toBe(true);
  expect(await entrar(db, "dono@x.com", SENHA, "6.6.6.6")).toEqual({ ok: false, motivo: "bloqueado" });

  // 20 falhas de admin não bloqueiam dono
  for (let i = 0; i < 20; i++) await falhas(db, `admin:u${i}@x.com`, "4.4.4.4", 1);
  expect((await entrar(db, "dono@x.com", SENHA, "4.4.4.4")).ok).toBe(true);
  expect(await entrarAdmin(db, "admin@strukti.com", SENHA, "4.4.4.4")).toEqual({ ok: false, motivo: "bloqueado" });
});

test("sessão de admin não vale como de dono, e vice-versa", async () => {
  const db = await preparar();
  const arena = await criarArena(db, "Arena");
  await db.query("insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'dono@x.com', $2, 'dono')", [arena.id, await hashSenha(SENHA)]);
  const adm = await entrarAdmin(db, "admin@strukti.com", SENHA, "1.1.1.1");
  const dono = await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  if (!adm.ok || !dono.ok) throw new Error("login falhou");
  expect(await validarSessao(db, adm.token)).toBeNull();
  expect(await validarSessaoAdmin(db, dono.token)).toBeNull();
});

test("dono não pode ter o e-mail do admin (um e-mail, uma conta) e o login de um não entra no outro", async () => {
  const db = await preparar();
  const arena = await criarArena(db, "Arena");
  await expect(db.query("insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'admin@strukti.com', $2, 'dono')", [arena.id, await hashSenha("outra-senha-dono")])).rejects.toThrow();
  expect((await entrarAdmin(db, "admin@strukti.com", "outra-senha-dono", "1.1.1.1")).ok).toBe(false);
  expect((await entrar(db, "admin@strukti.com", SENHA, "1.1.1.1")).ok).toBe(false);
});

test("o banco guarda só o hash do token; vencida e malformada dão null sem tocar o banco", async () => {
  const db = await preparar();
  const r = await entrarAdmin(db, "admin@strukti.com", SENHA, "1.1.1.1");
  if (!r.ok) throw new Error("login falhou");
  const h = await db.query<{ token_hash: string }>("select token_hash from sessoes_admin");
  expect(h.rows[0].token_hash).not.toContain(r.token);
  await db.query("update sessoes_admin set expira_em = now() - interval '1 second'");
  expect(await validarSessaoAdmin(db, r.token)).toBeNull();
  const falso = { query: () => { throw new Error("tocou no banco"); } } as unknown as Db;
  expect(await validarSessaoAdmin(falso, "abc")).toBeNull();
  await expect(sairAdmin(falso, "abc")).resolves.toBeUndefined();
});

test("apagar o super admin apaga as sessões dele", async () => {
  const db = await preparar();
  await entrarAdmin(db, "admin@strukti.com", SENHA, "1.1.1.1");
  await db.query("delete from super_admins");
  expect((await db.query("select 1 from sessoes_admin")).rows).toHaveLength(0);
});

import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena } from "./fixtures";
import type { Db } from "../app/lib/db";
import { hashSenha } from "../app/lib/senha";
import { validarSessao } from "../app/lib/sessao";
import { validarSessaoAdmin } from "../app/lib/sessao-admin";
import { criarContaJogador, validarSessaoJogador } from "../app/lib/jogadores";
import { definirStatusArena } from "../app/lib/plataforma";
import { caminhoSeguro, destinoDoTipo, entrarUnico } from "../app/lib/entrar-unico";

const SENHA = "senha-certa-123";

async function preparar() {
  const db = await novoBanco();
  const arena = await criarArena(db, "Arena do Dono");
  const hash = await hashSenha(SENHA);
  await db.query("insert into super_admins (email, senha_hash) values ('admin@x.com', $1)", [hash]);
  await db.query(
    "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'dono@x.com', $2, 'dono')",
    [arena.id, hash],
  );
  const j = await criarContaJogador(db, { nome: "Ana", email: "jogador@x.com", senha: SENHA, aceitouTermos: true });
  if (!j.ok) throw new Error("conta do jogador falhou");
  return { db, arena };
}

async function falhas(db: Db, email: string, ip: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db.query("insert into tentativas_login (email, ip) values ($1, $2)", [`entrar:${email}`, ip]);
  }
}

test("leva cada tipo à sua área", async () => {
  const { db, arena } = await preparar();
  const adm = await entrarUnico(db, "admin@x.com", SENHA, "1.1.1.1");
  const dono = await entrarUnico(db, "dono@x.com", SENHA, "1.1.1.1");
  const jog = await entrarUnico(db, "jogador@x.com", SENHA, "1.1.1.1");
  if (!adm.ok || !dono.ok || !jog.ok) throw new Error("login falhou");
  expect([adm.tipo, dono.tipo, jog.tipo]).toEqual(["admin", "dono", "jogador"]);

  expect(await validarSessaoAdmin(db, adm.token)).toMatchObject({ email: "admin@x.com" });
  expect(await validarSessao(db, adm.token)).toBeNull();
  expect(await validarSessaoJogador(db, adm.token)).toBeNull();

  expect(await validarSessao(db, dono.token)).toMatchObject({ arenaId: arena.id, email: "dono@x.com" });
  expect(await validarSessaoAdmin(db, dono.token)).toBeNull();
  expect(await validarSessaoJogador(db, dono.token)).toBeNull();

  expect(await validarSessaoJogador(db, jog.token)).toMatchObject({ nome: "Ana", email: "jogador@x.com" });
  expect(await validarSessao(db, jog.token)).toBeNull();
  expect(await validarSessaoAdmin(db, jog.token)).toBeNull();

  expect(jog.expiraEm.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
});

test("destinoDoTipo leva cada tipo à sua área", () => {
  expect(destinoDoTipo("admin")).toBe("/admin");
  expect(destinoDoTipo("dono")).toBe("/painel");
  expect(destinoDoTipo("jogador")).toBe("/minhas-reservas");
});

test("e-mail normalizado", async () => {
  const { db } = await preparar();
  const r = await entrarUnico(db, "  JOGADOR@x.com ", SENHA, "1.1.1.1");
  expect(r).toMatchObject({ ok: true, tipo: "jogador" });
});

test("mesma resposta para e-mail inexistente e senha errada", async () => {
  const { db } = await preparar();
  const a = await entrarUnico(db, "jogador@x.com", "errada", "1.1.1.1");
  const b = await entrarUnico(db, "naoexiste@x.com", "errada", "1.1.1.1");
  const c = await entrarUnico(db, "dono@x.com", "errada", "1.1.1.1");
  const d = await entrarUnico(db, "admin@x.com", "errada", "1.1.1.1");
  expect(a).toEqual({ ok: false, motivo: "credenciais" });
  expect(b).toEqual(a);
  expect(c).toEqual(a);
  expect(d).toEqual(a);
});

test("dono de arena suspensa: suspensa só com a senha certa", async () => {
  const { db, arena } = await preparar();
  const aberta = await entrarUnico(db, "dono@x.com", SENHA, "1.1.1.1");
  if (!aberta.ok) throw new Error("login falhou");
  await definirStatusArena(db, arena.id, "suspensa");
  expect(await validarSessao(db, aberta.token)).toBeNull();
  expect(await entrarUnico(db, "dono@x.com", SENHA, "1.1.1.1")).toEqual({ ok: false, motivo: "suspensa" });
  expect(await entrarUnico(db, "dono@x.com", "errada", "1.1.1.1")).toEqual({ ok: false, motivo: "credenciais" });
  expect((await db.query("select 1 from sessoes")).rows).toHaveLength(0);

  await definirStatusArena(db, arena.id, "ativa");
  expect(await validarSessao(db, aberta.token)).toBeNull(); // sessão antiga não revive
  expect((await entrarUnico(db, "dono@x.com", SENHA, "1.1.1.1")).ok).toBe(true);
});

test("bloqueia após 5 falhas do e-mail", async () => {
  const { db } = await preparar();
  for (let i = 0; i < 5; i++) {
    expect(await entrarUnico(db, "jogador@x.com", "errada", "2.2.2.2")).toEqual({ ok: false, motivo: "credenciais" });
  }
  expect(await entrarUnico(db, "jogador@x.com", SENHA, "3.3.3.3")).toEqual({ ok: false, motivo: "bloqueado" });
  // tentativa bloqueada não deixa linha
  expect((await db.query("select 1 from tentativas_login")).rows).toHaveLength(5);
  await db.query("update tentativas_login set em = now() - interval '16 minutes'");
  expect((await entrarUnico(db, "jogador@x.com", SENHA, "3.3.3.3")).ok).toBe(true);
});

test("4 falhas do e-mail ainda não bloqueiam; chave entrar:<email>", async () => {
  const { db } = await preparar();
  await falhas(db, "admin@x.com", "2.2.2.2", 4);
  expect((await entrarUnico(db, "admin@x.com", SENHA, "3.3.3.3")).ok).toBe(true);
  await entrarUnico(db, "Novo@X.com", "errada", "7.7.7.7");
  const k = await db.query<{ email: string }>("select email from tentativas_login where ip = '7.7.7.7'");
  expect(k.rows).toEqual([{ email: "entrar:novo@x.com" }]);
});

test("20 falhas do IP, de quaisquer contas, bloqueiam outro e-mail desse IP, mas não outro IP", async () => {
  const { db } = await preparar();
  for (let i = 0; i < 20; i++) await falhas(db, `u${i}@x.com`, "9.9.9.9", 1);
  expect(await entrarUnico(db, "dono@x.com", SENHA, "9.9.9.9")).toEqual({ ok: false, motivo: "bloqueado" });
  expect(await entrarUnico(db, "admin@x.com", SENHA, "9.9.9.9")).toEqual({ ok: false, motivo: "bloqueado" });
  expect((await entrarUnico(db, "dono@x.com", SENHA, "8.8.8.8")).ok).toBe(true);
});

test("sucesso apaga só as falhas da própria chave", async () => {
  const { db } = await preparar();
  await entrarUnico(db, "dono@x.com", "errada", "1.1.1.1");
  await entrarUnico(db, "outro@x.com", "errada", "1.1.1.1");
  expect((await entrarUnico(db, "dono@x.com", SENHA, "1.1.1.1")).ok).toBe(true);
  const depois = await db.query<{ email: string }>("select email from tentativas_login");
  expect(depois.rows.map((r) => r.email)).toEqual(["entrar:outro@x.com"]);
});

test("tentativas concorrentes não furam o limite: no máximo 5 conferem a senha", async () => {
  const { db } = await preparar();
  const rs = await Promise.all(
    Array.from({ length: 10 }, () => entrarUnico(db, "dono@x.com", "errada", "1.1.1.1")),
  );
  const conferidas = rs.filter((r) => !r.ok && r.motivo === "credenciais").length;
  const bloqueadas = rs.filter((r) => !r.ok && r.motivo === "bloqueado").length;
  expect(conferidas).toBeLessThanOrEqual(5);
  expect(conferidas + bloqueadas).toBe(10);
});

test("a cada entrada apaga tentativas com mais de 1 dia", async () => {
  const { db } = await preparar();
  await falhas(db, "velho@x.com", "7.7.7.7", 1);
  await db.query("update tentativas_login set em = now() - interval '2 days'");
  expect((await entrarUnico(db, "dono@x.com", SENHA, "1.1.1.1")).ok).toBe(true);
  expect((await db.query("select 1 from tentativas_login")).rows).toHaveLength(0);
});

test("entradas sem texto não lançam", async () => {
  const { db } = await preparar();
  const r = await entrarUnico(db, undefined as unknown as string, null as unknown as string, "1.1.1.1");
  expect(r).toEqual({ ok: false, motivo: "credenciais" });
});

test("caminhoSeguro só aceita caminho interno", () => {
  expect(caminhoSeguro("/a/x?y=1")).toBe("/a/x?y=1");
  expect(caminhoSeguro("/")).toBe("/");
  for (const v of [null, undefined, 42, "", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:x", "a/b", "/" + "x".repeat(600)]) {
    expect(caminhoSeguro(v)).toBeNull();
  }
});

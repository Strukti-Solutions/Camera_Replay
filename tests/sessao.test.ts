import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena } from "./fixtures";
import { hashSenha } from "../app/lib/senha";
import { DURACAO_SESSAO_S, entrar, sair, validarSessao } from "../app/lib/sessao";
import type { Db } from "../app/lib/db";
import { definirStatusArena } from "../app/lib/plataforma";

const SENHA = "correta-123";

async function preparar() {
  const db = await novoBanco();
  const arena = await criarArena(db, "Arena do Dono");
  await db.query(
    "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'dono@x.com', $2, 'dono')",
    [arena.id, await hashSenha(SENHA)],
  );
  return { db, arena };
}

async function falhas(db: Db, email: string, ip: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db.query("insert into tentativas_login (email, ip) values ($1, $2)", [`dono:${email}`, ip]);
  }
}

test("senha certa entra e a sessão devolve arena e e-mail; e-mail é normalizado", async () => {
  const { db, arena } = await preparar();
  const r = await entrar(db, "  Dono@X.com ", SENHA, "1.1.1.1");
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.expiraEm.getTime()).toBeGreaterThan(Date.now() + (DURACAO_SESSAO_S - 60) * 1000);
  const s = await validarSessao(db, r.token);
  expect(s).toMatchObject({ arenaId: arena.id, arenaNome: "Arena do Dono", email: "dono@x.com" });
  expect(s?.usuarioId).toBeTruthy();
});

test("senha errada e e-mail inexistente dão a mesma resposta", async () => {
  const { db } = await preparar();
  const a = await entrar(db, "dono@x.com", "errada", "1.1.1.1");
  const b = await entrar(db, "naoexiste@x.com", "errada", "1.1.1.1");
  expect(a).toEqual({ ok: false, motivo: "credenciais" });
  expect(b).toEqual(a);
});

test("5 falhas do e-mail bloqueiam, mesmo com a senha certa; após 16 min libera", async () => {
  const { db } = await preparar();
  await falhas(db, "dono@x.com", "2.2.2.2", 5);
  expect(await entrar(db, "dono@x.com", SENHA, "3.3.3.3")).toEqual({ ok: false, motivo: "bloqueado" });
  await db.query("update tentativas_login set em = now() - interval '16 minutes'");
  expect((await entrar(db, "dono@x.com", SENHA, "3.3.3.3")).ok).toBe(true);
});

test("4 falhas do e-mail ainda não bloqueiam", async () => {
  const { db } = await preparar();
  await falhas(db, "dono@x.com", "2.2.2.2", 4);
  expect((await entrar(db, "dono@x.com", SENHA, "3.3.3.3")).ok).toBe(true);
});

test("20 falhas do IP bloqueiam outro e-mail desse IP, mas não outro IP", async () => {
  const { db } = await preparar();
  for (let i = 0; i < 20; i++) await falhas(db, `u${i}@x.com`, "9.9.9.9", 1);
  expect(await entrar(db, "dono@x.com", SENHA, "9.9.9.9")).toEqual({ ok: false, motivo: "bloqueado" });
  expect((await entrar(db, "dono@x.com", SENHA, "8.8.8.8")).ok).toBe(true);
});

test("falha grava tentativa e sucesso apaga as falhas do e-mail", async () => {
  const { db } = await preparar();
  await entrar(db, "dono@x.com", "errada", "1.1.1.1");
  await entrar(db, "outro@x.com", "errada", "1.1.1.1");
  const antes = await db.query("select email from tentativas_login");
  expect(antes.rows).toHaveLength(2);
  expect((await entrar(db, "dono@x.com", SENHA, "1.1.1.1")).ok).toBe(true);
  const depois = await db.query<{ email: string }>("select email from tentativas_login");
  expect(depois.rows.map((r) => r.email)).toEqual(["dono:outro@x.com"]);
});

test("sair invalida a sessão e token desconhecido não lança", async () => {
  const { db } = await preparar();
  const r = await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  if (!r.ok) throw new Error("login falhou");
  await sair(db, r.token);
  expect(await validarSessao(db, r.token)).toBeNull();
  await expect(sair(db, "abc")).resolves.toBeUndefined();
  await expect(sair(db, "a".repeat(43))).resolves.toBeUndefined();
});

test("sessão vencida e token fora do formato dão null", async () => {
  const { db } = await preparar();
  const r = await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  if (!r.ok) throw new Error("login falhou");
  await db.query("update sessoes set expira_em = now() - interval '1 second'");
  expect(await validarSessao(db, r.token)).toBeNull();
  expect(await validarSessao(db, "abc")).toBeNull();
});

test("token fora do formato não toca no banco", async () => {
  const db = { query: () => { throw new Error("tocou no banco"); } } as unknown as Db;
  expect(await validarSessao(db, "abc")).toBeNull();
  await expect(sair(db, "abc")).resolves.toBeUndefined();
});

test("o banco não guarda o token em claro", async () => {
  const { db } = await preparar();
  const r = await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  if (!r.ok) throw new Error("login falhou");
  const h = await db.query<{ token_hash: string }>("select token_hash from sessoes");
  expect(h.rows).toHaveLength(1);
  expect(h.rows[0].token_hash).not.toBe(r.token);
  expect(h.rows[0].token_hash).not.toContain(r.token);
});

test("a cada entrada apaga sessões vencidas e tentativas com mais de 1 dia", async () => {
  const { db } = await preparar();
  const r = await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  if (!r.ok) throw new Error("login falhou");
  await db.query("update sessoes set expira_em = now() - interval '1 hour'");
  await falhas(db, "velho@x.com", "7.7.7.7", 1);
  await db.query("update tentativas_login set em = now() - interval '2 days'");
  await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  expect((await db.query("select 1 from sessoes")).rows).toHaveLength(1);
  expect((await db.query("select 1 from tentativas_login")).rows).toHaveLength(0);
});

test("tentativas concorrentes não furam o limite: no máximo 5 conferem a senha", async () => {
  const { db } = await preparar();
  const rs = await Promise.all(
    Array.from({ length: 10 }, () => entrar(db, "dono@x.com", "errada", "1.1.1.1")),
  );
  // No máximo 5 conferem a senha; o resto é bloqueado (pode ser menos de 5 se todas
  // inserirem antes de contar, o que é o lado seguro).
  const conferidas = rs.filter((r) => !r.ok && r.motivo === "credenciais").length;
  const bloqueadas = rs.filter((r) => !r.ok && r.motivo === "bloqueado").length;
  expect(conferidas).toBeLessThanOrEqual(5);
  expect(conferidas + bloqueadas).toBe(10);
});

test("tentativa bloqueada não deixa linha em tentativas_login", async () => {
  const { db } = await preparar();
  await falhas(db, "dono@x.com", "2.2.2.2", 5);
  expect(await entrar(db, "dono@x.com", SENHA, "3.3.3.3")).toEqual({ ok: false, motivo: "bloqueado" });
  expect((await db.query("select 1 from tentativas_login")).rows).toHaveLength(5);
});

test("arena suspensa: dono não entra (motivo suspensa, só com a senha certa) e sessão aberta cai e não revive ao reativar", async () => {
  const { db, arena } = await preparar();
  const aberta = await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  if (!aberta.ok) throw new Error("login falhou");
  await definirStatusArena(db, arena.id, "suspensa");
  expect(await validarSessao(db, aberta.token)).toBeNull();
  expect(await entrar(db, "dono@x.com", SENHA, "1.1.1.1")).toEqual({ ok: false, motivo: "suspensa" });
  // senha errada continua sendo "credenciais": não revela o estado a quem não sabe a senha
  expect(await entrar(db, "dono@x.com", "errada", "1.1.1.1")).toEqual({ ok: false, motivo: "credenciais" });
  expect((await db.query("select 1 from sessoes")).rows).toHaveLength(0); // a antiga foi apagada e nenhuma nova entrou

  await definirStatusArena(db, arena.id, "ativa");
  expect(await validarSessao(db, aberta.token)).toBeNull(); // sessão antiga não revive
  expect((await entrar(db, "dono@x.com", SENHA, "1.1.1.1")).ok).toBe(true);
});

test("limite por IP só conta tentativas do mesmo tipo (dono:)", async () => {
  const { db } = await preparar();
  for (let i = 0; i < 25; i++) {
    await db.query("insert into tentativas_login (email, ip) values ($1, '9.9.9.9')", [`aluno:arena:u${i}@x.com`]);
  }
  expect((await entrar(db, "dono@x.com", SENHA, "9.9.9.9")).ok).toBe(true);
});

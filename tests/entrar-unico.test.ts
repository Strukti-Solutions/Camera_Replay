import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena } from "./fixtures";
import type { Db } from "../app/lib/db";
import { hashSenha } from "../app/lib/senha";
import { registrarTentativa, validarSessao } from "../app/lib/sessao";
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

async function falhas(db: Db, chave: string, ip: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db.query("insert into tentativas_login (email, ip) values ($1, $2)", [chave, ip]);
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

async function contar(db: Db, tabela: string): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from ${tabela}`)).rows[0].n;
}

test("bloqueia após 5 falhas do e-mail", async () => {
  const { db } = await preparar();
  for (let i = 0; i < 5; i++) {
    expect(await entrarUnico(db, "jogador@x.com", "errada", "2.2.2.2")).toEqual({ ok: false, motivo: "credenciais" });
    expect(await entrarUnico(db, "dono@x.com", "errada", "2.2.2.2")).toEqual({ ok: false, motivo: "credenciais" });
  }
  // a 6ª, mesmo com a senha certa, responde "credenciais" e não abre sessão
  expect(await entrarUnico(db, "jogador@x.com", SENHA, "3.3.3.3")).toEqual({ ok: false, motivo: "credenciais" });
  expect(await entrarUnico(db, "dono@x.com", SENHA, "3.3.3.3")).toEqual({ ok: false, motivo: "credenciais" });
  expect(await contar(db, "sessoes_jogador")).toBe(0);
  expect(await contar(db, "sessoes")).toBe(0);
  await db.query("delete from tentativas_login where email = 'dono:dono@x.com'");
  // tentativa bloqueada não deixa linha
  expect((await db.query("select 1 from tentativas_login")).rows).toHaveLength(5);
  await db.query("update tentativas_login set em = now() - interval '16 minutes'");
  expect((await entrarUnico(db, "jogador@x.com", SENHA, "3.3.3.3")).ok).toBe(true);
});

test("4 falhas do e-mail ainda não bloqueiam; chave <tipo>:<email>, e-mail sem conta no balde de jogador", async () => {
  const { db } = await preparar();
  await falhas(db, "admin:admin@x.com", "2.2.2.2", 4);
  expect((await entrarUnico(db, "admin@x.com", SENHA, "3.3.3.3")).ok).toBe(true);
  await entrarUnico(db, "Novo@X.com", "errada", "7.7.7.7");
  await entrarUnico(db, "jogador@x.com", "errada", "7.7.7.7");
  await entrarUnico(db, "dono@x.com", "errada", "7.7.7.7");
  await entrarUnico(db, "admin@x.com", "errada", "7.7.7.7");
  const k = await db.query<{ email: string }>("select email from tentativas_login where ip = '7.7.7.7' order by email");
  expect(k.rows.map((r) => r.email)).toEqual([
    "admin:admin@x.com", "dono:dono@x.com", "jogador:jogador@x.com", "jogador:novo@x.com",
  ]);
});

test("IP esgotado no balde jogador: ninguém recebe bloqueado, e o tipo da conta não vaza", async () => {
  const { db } = await preparar();
  // atacante esgota o balde jogador: do IP com e-mails aleatórios
  for (let i = 0; i < 20; i++) await falhas(db, `jogador:aleatorio${i}@x.com`, "9.9.9.9", 1);
  // e-mail sem conta e jogador (o balde esgotado) recebem "credenciais", não "bloqueado"
  expect(await entrarUnico(db, "naoexiste@x.com", "errada", "9.9.9.9")).toEqual({ ok: false, motivo: "credenciais" });
  expect(await entrarUnico(db, "jogador@x.com", SENHA, "9.9.9.9")).toEqual({ ok: false, motivo: "credenciais" });
  // dono e admin errando a senha também recebem "credenciais": a mesma resposta para todos
  expect(await entrarUnico(db, "dono@x.com", "errada", "9.9.9.9")).toEqual({ ok: false, motivo: "credenciais" });
  expect(await entrarUnico(db, "admin@x.com", "errada", "9.9.9.9")).toEqual({ ok: false, motivo: "credenciais" });
  // dono e admin continuam entrando com a senha certa nesse IP
  expect(await entrarUnico(db, "dono@x.com", SENHA, "9.9.9.9")).toMatchObject({ ok: true, tipo: "dono" });
  expect(await entrarUnico(db, "admin@x.com", SENHA, "9.9.9.9")).toMatchObject({ ok: true, tipo: "admin" });
  // o jogador entra de outro IP
  expect((await entrarUnico(db, "jogador@x.com", SENHA, "8.8.8.8")).ok).toBe(true);
});

test("oráculo: com o balde jogador: do IP esgotado, e-mail sem conta e dono recebem respostas idênticas", async () => {
  const { db } = await preparar();
  for (let i = 0; i < 20; i++) await falhas(db, `jogador:aleatorio${i}@x.com`, "9.9.9.9", 1);
  const respostas = [];
  for (let i = 0; i < 6; i++) respostas.push(await entrarUnico(db, "naoexiste@x.com", "errada", "9.9.9.9"));
  for (let i = 0; i < 6; i++) respostas.push(await entrarUnico(db, "dono@x.com", "errada", "9.9.9.9"));
  expect(respostas).toHaveLength(12);
  for (const r of respostas) expect(r).toEqual({ ok: false, motivo: "credenciais" });
});

test("IP esgotado no balde dono: o dono recebe credenciais nesse IP, e o jogador entra", async () => {
  const { db } = await preparar();
  for (let i = 0; i < 20; i++) await falhas(db, `dono:u${i}@x.com`, "9.9.9.9", 1);
  expect(await entrarUnico(db, "dono@x.com", SENHA, "9.9.9.9")).toEqual({ ok: false, motivo: "credenciais" });
  expect((await entrarUnico(db, "jogador@x.com", SENHA, "9.9.9.9")).ok).toBe(true);
  expect((await entrarUnico(db, "dono@x.com", SENHA, "8.8.8.8")).ok).toBe(true);
});

test("registrarTentativa diz qual limite estourou", async () => {
  const { db } = await preparar();
  expect(await registrarTentativa(db, "jogador:a@x.com", "1.1.1.1")).toBeNull();
  // só o IP estourou
  for (let i = 0; i < 20; i++) await falhas(db, `jogador:u${i}@x.com`, "9.9.9.9", 1);
  expect(await registrarTentativa(db, "jogador:b@x.com", "9.9.9.9")).toBe("ip");
  // só o e-mail estourou
  await falhas(db, "dono:c@x.com", "2.2.2.2", 5);
  expect(await registrarTentativa(db, "dono:c@x.com", "3.3.3.3")).toBe("email");
  // os dois estouraram: vale o e-mail
  await falhas(db, "jogador:d@x.com", "9.9.9.9", 5);
  expect(await registrarTentativa(db, "jogador:d@x.com", "9.9.9.9")).toBe("email");
});

test("sucesso apaga só as falhas da própria chave", async () => {
  const { db } = await preparar();
  await entrarUnico(db, "dono@x.com", "errada", "1.1.1.1");
  await entrarUnico(db, "outro@x.com", "errada", "1.1.1.1");
  expect((await entrarUnico(db, "dono@x.com", SENHA, "1.1.1.1")).ok).toBe(true);
  const depois = await db.query<{ email: string }>("select email from tentativas_login");
  expect(depois.rows.map((r) => r.email)).toEqual(["jogador:outro@x.com"]);
});

test("tentativas concorrentes não furam o limite: no máximo 5 conferem a senha", async () => {
  const { db } = await preparar();
  const rs = await Promise.all(
    Array.from({ length: 10 }, () => entrarUnico(db, "dono@x.com", "errada", "1.1.1.1")),
  );
  // Todas respondem "credenciais"; só as que passaram do limite deixam linha
  // (a bloqueada apaga a sua), então no máximo 5 chegaram a conferir a senha.
  expect(rs.every((r) => !r.ok && r.motivo === "credenciais")).toBe(true);
  expect(await contar(db, "tentativas_login")).toBeLessThanOrEqual(5);
});

test("a cada entrada apaga tentativas com mais de 1 dia", async () => {
  const { db } = await preparar();
  await falhas(db, "jogador:velho@x.com", "7.7.7.7", 1);
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
  const limite = "/" + "x".repeat(511);
  expect(caminhoSeguro(limite)).toBe(limite); // 512 caracteres
  expect(caminhoSeguro(limite + "x")).toBeNull(); // 513
  for (const v of [null, undefined, 42, "", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:x", "a/b", "/" + "x".repeat(600)]) {
    expect(caminhoSeguro(v)).toBeNull();
  }
});

test("e-mail longo: a chave da tentativa usa o e-mail cortado em 254", async () => {
  const { db } = await preparar();
  const longo = "  " + "A".repeat(300) + "@x.com";
  expect((await entrarUnico(db, longo, SENHA, "1.1.1.1")).ok).toBe(false);
  const r = await db.query<{ email: string }>("select email from tentativas_login");
  expect(r.rows).toEqual([{ email: `jogador:${"a".repeat(254)}` }]);
});

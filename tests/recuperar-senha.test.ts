import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena } from "./fixtures";
import type { Db } from "../app/lib/db";
import type { MensagemEmail } from "../app/lib/email";
import { entrarUnico } from "../app/lib/entrar-unico";
import { apagarContaJogador, criarContaJogador, criarSessaoJogador, validarSessaoJogador } from "../app/lib/jogadores";
import { hashSenha } from "../app/lib/senha";
import { criarSessaoDono, validarSessao } from "../app/lib/sessao";
import { criarSessaoAdmin, validarSessaoAdmin } from "../app/lib/sessao-admin";
import { pedirRecuperacao, redefinirSenha, VALIDADE_LINK_S } from "../app/lib/recuperar-senha";

const SENHA = "senha-certa-123";
const APP = "https://replay.exemplo";
const IP = "1.1.1.1";

async function preparar() {
  const db = await novoBanco();
  const arena = await criarArena(db, "Arena do Dono");
  const hash = await hashSenha(SENHA);
  const adm = await db.query<{ id: string }>(
    "insert into super_admins (email, senha_hash) values ('a@x.com', $1) returning id", [hash]);
  const dono = await db.query<{ id: string }>(
    "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'd@x.com', $2, 'dono') returning id",
    [arena.id, hash],
  );
  const j = await criarContaJogador(db, { nome: "Ana", email: "j@x.com", senha: SENHA, aceitouTermos: true });
  if (!j.ok) throw new Error("conta do jogador falhou");
  return { db, arenaId: arena.id, jogadorId: j.jogadorId, donoId: dono.rows[0].id, adminId: adm.rows[0].id };
}

function caixa() {
  const msgs: MensagemEmail[] = [];
  const enviar = async (m: MensagemEmail) => { msgs.push(m); };
  return { msgs, enviar };
}

function tokenDe(m: MensagemEmail): string {
  const t = /\/redefinir-senha\?t=([A-Za-z0-9_-]+)/.exec(m.texto)?.[1];
  if (!t) throw new Error("sem link no e-mail");
  return t;
}

async function pedirToken(db: Db, email: string): Promise<string> {
  const c = caixa();
  await pedirRecuperacao(db, email, IP, APP, c.enviar);
  expect(c.msgs).toHaveLength(1);
  return tokenDe(c.msgs[0]);
}

test("envia o link para jogador, dono e admin com e-mail normalizado", async () => {
  const { db } = await preparar();
  for (const [digitado, email] of [["  J@x.com ", "j@x.com"], [" D@X.COM", "d@x.com"], ["a@x.com ", "a@x.com"]]) {
    const c = caixa();
    await pedirRecuperacao(db, digitado, IP, APP, c.enviar);
    expect(c.msgs).toHaveLength(1);
    expect(c.msgs[0].para).toBe(email);
    expect(c.msgs[0].assunto).toBe("Redefinir sua senha do Replay");
    expect(c.msgs[0].texto).toContain(`${APP}/redefinir-senha?t=`);
    expect(c.msgs[0].texto).toContain("1 hora");
  }
  // O banco guarda só o hash do token.
  const r = await db.query<{ token_hash: string; tipo: string; segundos: number }>(
    "select token_hash, tipo, extract(epoch from expira_em - criado_em)::int as segundos from tokens_senha order by tipo");
  expect(r.rows.map((l) => l.tipo)).toEqual(["admin", "dono", "jogador"]);
  expect(r.rows.every((l) => /^[0-9a-f]{64}$/.test(l.token_hash))).toBe(true);
  expect(r.rows.every((l) => l.segundos === VALIDADE_LINK_S)).toBe(true);
});

test("e-mail sem conta não envia nada", async () => {
  const { db } = await preparar();
  const c = caixa();
  await expect(pedirRecuperacao(db, "ninguem@x.com", IP, APP, c.enviar)).resolves.toBeUndefined();
  expect(c.msgs).toHaveLength(0);
  expect((await db.query("select 1 from tokens_senha")).rows).toHaveLength(0);
});

test("pedido bloqueado pelo limite não envia nada", async () => {
  const { db } = await preparar();
  const c = caixa();
  for (let i = 0; i < 6; i++) await pedirRecuperacao(db, "j@x.com", IP, APP, c.enviar);
  expect(c.msgs).toHaveLength(5);
  const chaves = await db.query<{ email: string }>("select distinct email from tentativas_login");
  expect(chaves.rows).toEqual([{ email: "recuperar:j@x.com" }]);
});

test("link troca a senha uma vez só e derruba as sessões", async () => {
  const { db, jogadorId } = await preparar();
  const antiga = await criarSessaoJogador(db, jogadorId);
  const t = await pedirToken(db, "j@x.com");

  expect(await redefinirSenha(db, t, "nova-senha-1")).toEqual({ ok: true, tipo: "jogador" });
  expect(await validarSessaoJogador(db, antiga.token)).toBeNull();
  expect((await entrarUnico(db, "j@x.com", "nova-senha-1", IP)).ok).toBe(true);
  expect((await entrarUnico(db, "j@x.com", SENHA, IP)).ok).toBe(false);
  expect(await redefinirSenha(db, t, "outra-senha-2")).toEqual({ ok: false, erro: "link" });
});

test("dono e admin: mínimo do tipo e sessões derrubadas", async () => {
  const { db, arenaId, donoId, adminId } = await preparar();
  const sd = await criarSessaoDono(db, donoId, arenaId);
  const sa = await criarSessaoAdmin(db, adminId);
  const td = await pedirToken(db, "d@x.com");
  const ta = await pedirToken(db, "a@x.com");

  expect(await redefinirSenha(db, td, "123456789")).toEqual({ ok: false, erro: "senha" });
  expect(await redefinirSenha(db, td, "1234567890")).toEqual({ ok: true, tipo: "dono" });
  expect(await validarSessao(db, sd.token)).toBeNull();

  expect(await redefinirSenha(db, ta, "12345678901")).toEqual({ ok: false, erro: "senha" });
  expect(await redefinirSenha(db, ta, "123456789012")).toEqual({ ok: true, tipo: "admin" });
  expect(await validarSessaoAdmin(db, sa.token)).toBeNull();

  expect((await entrarUnico(db, "d@x.com", "1234567890", IP)).ok).toBe(true);
  expect((await entrarUnico(db, "a@x.com", "123456789012", IP)).ok).toBe(true);
});

test("link vencido, adulterado ou de conta apagada é inválido", async () => {
  const { db } = await preparar();
  const t1 = await pedirToken(db, "j@x.com");
  await db.query("update tokens_senha set expira_em = now() - interval '1 second'");
  expect(await redefinirSenha(db, t1, "nova-senha-1")).toEqual({ ok: false, erro: "link" });

  const t2 = await pedirToken(db, "j@x.com");
  const trocado = (t2[0] === "A" ? "B" : "A") + t2.slice(1);
  expect(await redefinirSenha(db, trocado, "nova-senha-1")).toEqual({ ok: false, erro: "link" });

  const j = await db.query<{ id: string }>("select id from jogadores where email = 'j@x.com'");
  expect(await apagarContaJogador(db, j.rows[0].id, SENHA)).toEqual({ ok: true });
  expect((await db.query("select 1 from tokens_senha where tipo = 'jogador'")).rows).toHaveLength(0);
  expect(await redefinirSenha(db, t2, "nova-senha-1")).toEqual({ ok: false, erro: "link" });
});

test("token fora do formato não consulta o banco", async () => {
  const explode: Db = { query: async () => { throw new Error("consultou o banco"); } };
  for (const t of ["", "curto", "x".repeat(44), "a".repeat(42) + "!"]) {
    expect(await redefinirSenha(explode, t, "nova-senha-1")).toEqual({ ok: false, erro: "link" });
  }
  expect(await redefinirSenha(explode, undefined as unknown as string, "nova-senha-1"))
    .toEqual({ ok: false, erro: "link" });
});

test("senha curta não gasta o link", async () => {
  const { db } = await preparar();
  const t = await pedirToken(db, "j@x.com");
  expect(await redefinirSenha(db, t, "curta")).toEqual({ ok: false, erro: "senha" });
  expect(await redefinirSenha(db, t, "nova-senha-1")).toEqual({ ok: true, tipo: "jogador" });
});

test("pedir um link novo não invalida o anterior; usar um invalida os dois", async () => {
  const { db } = await preparar();
  const t1 = await pedirToken(db, "j@x.com");
  const t2 = await pedirToken(db, "j@x.com");
  expect(t1).not.toBe(t2);
  expect(await redefinirSenha(db, t1, "nova-senha-1")).toEqual({ ok: true, tipo: "jogador" });
  expect(await redefinirSenha(db, t2, "nova-senha-2")).toEqual({ ok: false, erro: "link" });
  expect(await redefinirSenha(db, t1, "nova-senha-3")).toEqual({ ok: false, erro: "link" });
});

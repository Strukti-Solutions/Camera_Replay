import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { hashSenha } from "../app/lib/senha";
import { novoBanco } from "./db";
import { criarArena, criarQuadra } from "./fixtures";
import { criarArenaComDono } from "../app/lib/donos";
import { criarArenaAdmin } from "../app/lib/plataforma";
import {
  TERMOS_VERSAO, apagarContaJogador, criarContaJogador, criarSessaoJogador,
  trocarSenhaJogador, validarSessaoJogador,
} from "../app/lib/jogadores";

const SENHA = "senha-boa-1";
const conta = (email: string) => ({ nome: "Ana", email, senha: SENHA, aceitouTermos: true });

test("cria conta com e-mail normalizado e entra na sessão", async () => {
  const db = await novoBanco();
  const r = await criarContaJogador(db, { nome: " Ana ", email: "  Ana@X.com ", senha: SENHA, aceitouTermos: true });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const l = await db.query<{ email: string; nome: string; termos_versao: string }>(
    "select email, nome, termos_versao from jogadores");
  expect(l.rows).toEqual([{ email: "ana@x.com", nome: "Ana", termos_versao: TERMOS_VERSAO }]);
  const { token } = await criarSessaoJogador(db, r.jogadorId);
  expect(await validarSessaoJogador(db, token)).toMatchObject({ nome: "Ana", email: "ana@x.com" });
});

test("recusa nome vazio, e-mail sem @, senha de 7 e termos não aceitos", async () => {
  const db = await novoBanco();
  expect(await criarContaJogador(db, { ...conta("a@x.com"), nome: "   " })).toEqual({ ok: false, erro: "nome" });
  expect(await criarContaJogador(db, conta("sem-arroba"))).toEqual({ ok: false, erro: "email" });
  expect(await criarContaJogador(db, { ...conta("a@x.com"), senha: "1234567" })).toEqual({ ok: false, erro: "senha" });
  expect(await criarContaJogador(db, { ...conta("a@x.com"), aceitouTermos: false })).toEqual({ ok: false, erro: "termos" });
  const c = await db.query<{ n: number }>("select count(*)::int as n from jogadores");
  expect(c.rows[0].n).toBe(0);
});

test("e-mail de dono ou admin não vira jogador, e vice-versa", async () => {
  const db = await novoBanco();
  await criarArenaComDono(db, { arena: "A", email: "dono@x.com", senha: "senha-do-dono-1" });
  expect(await criarContaJogador(db, conta("DONO@x.com"))).toEqual({ ok: false, erro: "email_em_uso" });

  expect((await criarContaJogador(db, conta("j@x.com"))).ok).toBe(true);
  const antes = await db.query<{ n: number }>("select count(*)::int as n from arenas");
  await expect(criarArenaAdmin(db, { arena: "B", email: "j@x.com", senha: "senha-do-dono-1" }))
    .rejects.toThrow("e-mail já cadastrado");
  const depois = await db.query<{ n: number }>("select count(*)::int as n from arenas");
  expect(depois.rows[0].n).toBe(antes.rows[0].n);
});

test("apagar conta pede a senha, derruba sessões e libera o e-mail", async () => {
  const db = await novoBanco();
  const r = await criarContaJogador(db, conta("a@x.com"));
  if (!r.ok) throw new Error("conta");
  const { token } = await criarSessaoJogador(db, r.jogadorId);
  expect(await apagarContaJogador(db, r.jogadorId, "errada-errada")).toEqual({ ok: false, erro: "senha" });
  expect(await validarSessaoJogador(db, token)).not.toBeNull();
  expect(await apagarContaJogador(db, r.jogadorId, SENHA)).toEqual({ ok: true });
  expect(await validarSessaoJogador(db, token)).toBeNull();
  expect((await criarContaJogador(db, conta("a@x.com"))).ok).toBe(true);
});

test("apagar conta recusa com reserva confirmada que ainda não terminou", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const r = await criarContaJogador(db, conta("a@x.com"));
  if (!r.ok) throw new Error("conta");
  const ins = (situacao: string, inicio: string, fim: string) => db.query(
    `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim, pagamento, total_centavos, taxa_centavos, detalhe)
     values ($1, $2, $3, 'reserva', $4, now() + $5::interval, now() + $6::interval, 'arena', 1, 0, '[]')`,
    [a.id, q.id, r.jogadorId, situacao, inicio, fim]);
  await ins("cancelada", "1 day", "1 day 1 hour");
  await ins("confirmada", "-30 minutes", "30 minutes"); // em andamento
  expect(await apagarContaJogador(db, r.jogadorId, SENHA)).toEqual({ ok: false, erro: "reservas_futuras" });
  await db.query("update reservas set situacao = 'cancelada', cancelada_por = 'dono', cancelada_em = now() where situacao = 'confirmada'");
  await ins("confirmada", "-2 hours", "-1 hour");
  expect(await apagarContaJogador(db, r.jogadorId, SENHA)).toEqual({ ok: true });
  const n = await db.query("select 1 from reservas where jogador_id is not null");
  expect(n.rows).toHaveLength(0);
});

test("trocar senha confere a atual e derruba as outras sessões", async () => {
  const db = await novoBanco();
  const r = await criarContaJogador(db, conta("a@x.com"));
  if (!r.ok) throw new Error("conta");
  const s1 = await criarSessaoJogador(db, r.jogadorId);
  const s2 = await criarSessaoJogador(db, r.jogadorId);
  expect(await trocarSenhaJogador(db, r.jogadorId, "errada-errada", "nova-senha-1", s1.token))
    .toEqual({ ok: false, erro: "senha_atual" });
  expect(await trocarSenhaJogador(db, r.jogadorId, SENHA, "curta", s1.token)).toEqual({ ok: false, erro: "senha" });
  expect(await trocarSenhaJogador(db, r.jogadorId, SENHA, "nova-senha-1", s1.token)).toEqual({ ok: true });
  expect(await validarSessaoJogador(db, s1.token)).not.toBeNull();
  expect(await validarSessaoJogador(db, s2.token)).toBeNull();
});

test("contas_email acompanha insert, update e delete de donos e admins", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await db.query("insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'd@x.com', 'h', 'dono')", [a.id]);
  await db.query("insert into super_admins (email, senha_hash) values ('s@x.com', 'h')");
  const tipos = async () =>
    (await db.query<{ email: string; tipo: string }>("select email, tipo from contas_email order by email")).rows;
  expect(await tipos()).toEqual([{ email: "d@x.com", tipo: "dono" }, { email: "s@x.com", tipo: "admin" }]);
  await db.query("update usuarios set email = 'd2@x.com'");
  await db.query("delete from super_admins");
  expect(await tipos()).toEqual([{ email: "d2@x.com", tipo: "dono" }]);
});

test("trocar senha apaga os links pendentes de Esqueci a senha do jogador", async () => {
  const db = await novoBanco();
  const r = await criarContaJogador(db, conta("a@x.com"));
  const o = await criarContaJogador(db, conta("b@x.com"));
  if (!r.ok || !o.ok) throw new Error("conta");
  const s1 = await criarSessaoJogador(db, r.jogadorId);
  const link = `insert into tokens_senha (tipo, conta_id, token_hash, expira_em) values ('jogador', $1, $2, now() + interval '1 hour')`;
  await db.query(link, [r.jogadorId, "t1"]);
  await db.query(link, [o.jogadorId, "t2"]);
  expect(await trocarSenhaJogador(db, r.jogadorId, SENHA, "nova-senha-1", s1.token)).toEqual({ ok: true });
  const t = await db.query<{ token_hash: string }>("select token_hash from tokens_senha");
  expect(t.rows).toEqual([{ token_hash: "t2" }]);
});

// Pool falso: no pg.Pool, apagar conta trava o jogador e só depois, em comando
// separado do mesmo cliente, confere as reservas futuras e apaga.
test("no pg.Pool, apagar conta trava o jogador antes de conferir reservas e apagar", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const hash = await hashSenha(SENHA);
  const log: string[] = [];
  const clientes: unknown[] = [];
  const fazer = (futuras: boolean) => ({
    query: async (sql: string) => {
      if (/from jogadores where id/.test(sql) && !/for update/.test(sql)) return { rows: [{ senha_hash: hash }] };
      throw new Error("fora da transação: " + sql);
    },
    async connect() {
      const cliente = {
        async query(sql: string) {
          const s = sql.trim();
          if (/^begin|^commit|^rollback/.test(s)) log.push(s);
          else if (/for update/.test(s)) log.push("trava");
          else if (/from reservas/.test(s) && /^select/.test(s)) log.push("confere");
          else if (/delete from jogadores/.test(s)) log.push("apaga");
          else log.push("?" + s);
          if (/for update/.test(s)) return { rows: [{ id }] };
          if (/from reservas/.test(s) && /^select/.test(s)) return { rows: futuras ? [{ "?column?": 1 }] : [] };
          return { rows: [] };
        },
        release() { clientes.push(cliente); },
      };
      return cliente;
    },
  }) as unknown as Db;

  expect(await apagarContaJogador(fazer(false), id, SENHA)).toEqual({ ok: true });
  expect(log).toEqual(["begin", "trava", "confere", "apaga", "commit"]);
  expect(clientes).toHaveLength(1);

  log.length = 0;
  expect(await apagarContaJogador(fazer(true), id, SENHA)).toEqual({ ok: false, erro: "reservas_futuras" });
  expect(log).toEqual(["begin", "trava", "confere", "commit"]);
});

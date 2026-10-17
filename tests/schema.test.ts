import { expect, test } from "vitest";
import { migrar } from "../db/migrar";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

const CLIPE = `insert into clipes (arena_id, aperto_id, camera_id, recebido_em, expira_em)
  values ($1, $2, $3, now(), now() + interval '7 days') returning id`;
const APERTO = "insert into apertos (arena_id, botao_id) values ($1, $2) returning id";

test("migrar aplica tudo uma vez e é idempotente", async () => {
  const db = await novoBanco();
  const r = await db.query<{ nome: string }>("select nome from schema_migrations");
  expect(r.rows.map((x) => x.nome)).toContain("0001_schema.sql");
  expect(await migrar(db)).toEqual([]);
});

test("botão não pode apontar para quadra de outra arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const qa = await criarQuadra(db, a.id);
  const ca = await criarCamera(db, a.id, qa.id);
  await expect(criarBotao(db, b.id, qa.id, ca.id)).rejects.toThrow(/foreign key/i);
});

test("botão não pode apontar para câmera de outra quadra", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q1 = await criarQuadra(db, a.id), q2 = await criarQuadra(db, a.id);
  const c2 = await criarCamera(db, a.id, q2.id);
  await expect(criarBotao(db, a.id, q1.id, c2.id)).rejects.toThrow(/foreign key/i);
});

test("clipe não pode apontar para câmera de outra arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const qa = await criarQuadra(db, a.id), qb = await criarQuadra(db, b.id);
  const ca = await criarCamera(db, a.id, qa.id);
  const cb = await criarCamera(db, b.id, qb.id);
  const ba = await criarBotao(db, a.id, qa.id, ca.id);
  const ap = await db.query<{ id: string }>(APERTO, [a.id, ba.id]);
  await expect(db.query(CLIPE, [a.id, ap.rows[0].id, cb.id])).rejects.toThrow(/foreign key/i);
});

test("status de clipe fora da lista é recusado", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q.id);
  const b = await criarBotao(db, a.id, q.id, c.id);
  const ap = await db.query<{ id: string }>(APERTO, [a.id, b.id]);
  const cl = await db.query<{ id: string }>(CLIPE, [a.id, ap.rows[0].id, c.id]);
  await expect(db.query("update clipes set status = 'xyz' where id = $1", [cl.rows[0].id]))
    .rejects.toThrow(/check/i);
});

test("slug curto é recusado", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await expect(db.query(
    "insert into quadras (arena_id, nome, slug) values ($1, 'Q', 'abc')", [a.id],
  )).rejects.toThrow(/check/i);
});

test("migrar registra a 0003_camera_fixa", async () => {
  const db = await novoBanco();
  const r = await db.query<{ nome: string }>("select nome from schema_migrations");
  expect(r.rows.map((x) => x.nome)).toContain("0003_camera_fixa.sql");
});

test("câmera não pode ser movida para outra quadra (mesma arena)", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q1 = await criarQuadra(db, a.id), q2 = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q1.id);
  await expect(db.query("update cameras set quadra_id = $2 where id = $1", [c.id, q2.id]))
    .rejects.toMatchObject({ code: "23514", message: expect.stringMatching(/quadra_id/) });
  const r = await db.query<{ quadra_id: string }>("select quadra_id from cameras where id = $1", [c.id]);
  expect(r.rows[0].quadra_id).toBe(q1.id);
});

test("câmera não pode mudar de arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q.id);
  await expect(db.query("update cameras set arena_id = $2 where id = $1", [c.id, b.id]))
    .rejects.toMatchObject({ code: "23514", message: expect.stringMatching(/arena_id/) });
});

test("câmera continua editável: nome, status, visto_em e credenciais", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q.id);
  await db.query(
    "update cameras set nome = 'Nova', status = 'online', visto_em = now(), credenciais = 'v1:a:b:c' where id = $1",
    [c.id],
  );
  const r = await db.query<{ nome: string; status: string; visto_em: Date | null; credenciais: string }>(
    "select nome, status, visto_em, credenciais from cameras where id = $1", [c.id]);
  expect(r.rows[0]).toMatchObject({ nome: "Nova", status: "online", credenciais: "v1:a:b:c" });
  expect(r.rows[0].visto_em).not.toBeNull();
  // update que repete os mesmos quadra_id e arena_id também passa
  await db.query("update cameras set quadra_id = quadra_id, arena_id = arena_id where id = $1", [c.id]);
});

async function criarUsuario(db: Awaited<ReturnType<typeof novoBanco>>, arenaId: string) {
  const r = await db.query<{ id: string }>(
    `insert into usuarios (arena_id, email, senha_hash, papel)
     values ($1, $2, 'h', 'dono') returning id`,
    [arenaId, `${Math.random()}@x.com`],
  );
  return r.rows[0].id;
}

const SESSAO = `insert into sessoes (arena_id, usuario_id, token_hash, expira_em)
  values ($1, $2, $3, now() + interval '7 days')`;

test("sessão com usuário de outra arena viola a FK", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const u = await criarUsuario(db, a.id);
  await expect(db.query(SESSAO, [b.id, u, "h1"])).rejects.toThrow(/foreign key/i);
});

test("apagar o usuário apaga as sessões", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const u = await criarUsuario(db, a.id);
  await db.query(SESSAO, [a.id, u, "h1"]);
  await db.query("delete from usuarios where id = $1", [u]);
  const r = await db.query("select 1 from sessoes");
  expect(r.rows).toHaveLength(0);
});

test("token_hash da sessão é único", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const u = await criarUsuario(db, a.id);
  await db.query(SESSAO, [a.id, u, "h1"]);
  await expect(db.query(SESSAO, [a.id, u, "h1"])).rejects.toThrow(/unique|duplicate/i);
});

test("tentativas_login grava em com padrão", async () => {
  const db = await novoBanco();
  await db.query("insert into tentativas_login (email, ip) values ('a@x.com', '1.2.3.4')");
  const r = await db.query<{ em: Date }>("select em from tentativas_login");
  expect(r.rows[0].em).toBeInstanceOf(Date);
});

test("cameras.criado_em e botoes.criado_em vêm preenchidos", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q.id);
  const b = await criarBotao(db, a.id, q.id, c.id);
  const rc = await db.query<{ criado_em: Date }>("select criado_em from cameras where id = $1", [c.id]);
  const rb = await db.query<{ criado_em: Date }>("select criado_em from botoes where id = $1", [b.id]);
  expect(rc.rows[0].criado_em).toBeInstanceOf(Date);
  expect(rb.rows[0].criado_em).toBeInstanceOf(Date);
});

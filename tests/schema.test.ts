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

import { expect, test } from "vitest";
import { registrarAperto } from "../app/lib/aperto";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

async function cenario(dias?: number) {
  const db = await novoBanco();
  const arena = await criarArena(db);
  if (dias) await db.query("update arenas set dias_retencao = $1 where id = $2", [dias, arena.id]);
  const quadra = await criarQuadra(db, arena.id);
  const camera = await criarCamera(db, arena.id, quadra.id);
  const botao = await criarBotao(db, arena.id, quadra.id, camera.id);
  return { db, arena, camera, botao };
}

test("token válido cria aperto e clipe pendente da câmera do botão", async () => {
  const { db, arena, camera, botao } = await cenario();
  const r = await registrarAperto(db, botao.token);
  expect(r?.duplicado).toBe(false);
  const c = await db.query(
    `select status, camera_id, arena_id, extract(epoch from expira_em - recebido_em) as seg
     from clipes where id = $1`, [r!.clipeId]);
  expect(c.rows[0]).toMatchObject({ status: "pendente", camera_id: camera.id, arena_id: arena.id });
  expect(Number(c.rows[0].seg)).toBe(7 * 86400);
});

test("segundo aperto em menos de 5 s devolve o mesmo clipe com duplicado=true", async () => {
  const { db, botao } = await cenario();
  const a = await registrarAperto(db, botao.token);
  const b = await registrarAperto(db, botao.token);
  expect(b).toEqual({ clipeId: a!.clipeId, duplicado: true });
  expect((await db.query("select count(*)::int as n from clipes")).rows[0].n).toBe(1);
  expect((await db.query("select count(*)::int as n from apertos")).rows[0].n).toBe(1);
});

test("aperto depois de 5 s cria outro clipe", async () => {
  const { db, botao } = await cenario();
  const a = await registrarAperto(db, botao.token);
  await db.query("update apertos set recebido_em = now() - interval '6 seconds'");
  const b = await registrarAperto(db, botao.token);
  expect(b!.duplicado).toBe(false);
  expect(b!.clipeId).not.toBe(a!.clipeId);
});

test("token desconhecido devolve null e não grava nada", async () => {
  const { db } = await cenario();
  expect(await registrarAperto(db, "x".repeat(43))).toBeNull();
  expect((await db.query("select count(*)::int as n from apertos")).rows[0].n).toBe(0);
  expect((await db.query("select count(*)::int as n from clipes")).rows[0].n).toBe(0);
});

test("token revogado devolve null", async () => {
  const { db, botao } = await cenario();
  await db.query("update botoes set revogado_em = now()");
  expect(await registrarAperto(db, botao.token)).toBeNull();
  expect((await db.query("select count(*)::int as n from apertos")).rows[0].n).toBe(0);
});

test("dias_retencao da arena define expira_em", async () => {
  const { db, botao } = await cenario(3);
  const r = await registrarAperto(db, botao.token);
  const c = await db.query(
    "select extract(epoch from expira_em - recebido_em) as seg from clipes where id = $1", [r!.clipeId]);
  expect(Number(c.rows[0].seg)).toBe(3 * 86400);
});

test("atualiza botoes.visto_em", async () => {
  const { db, botao } = await cenario();
  expect((await db.query("select visto_em from botoes")).rows[0].visto_em).toBeNull();
  await registrarAperto(db, botao.token);
  expect((await db.query("select visto_em from botoes")).rows[0].visto_em).not.toBeNull();
});

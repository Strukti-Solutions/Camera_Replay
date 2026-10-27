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
    `select status, camera_id, arena_id, (expira_em - recebido_em = interval '7 days') as sete_dias_padrao
     from clipes where id = $1`, [r!.clipeId]);
  expect(c.rows[0]).toMatchObject({
    status: "pendente", camera_id: camera.id, arena_id: arena.id, sete_dias_padrao: true,
  });
});

test("clipes.recebido_em é igual ao apertos.recebido_em", async () => {
  const { db, botao } = await cenario();
  await registrarAperto(db, botao.token);
  const r = await db.query(
    `select (c.recebido_em = a.recebido_em) as igual
     from clipes c join apertos a on a.id = c.aperto_id`);
  expect(r.rows).toEqual([{ igual: true }]);
});

test("dois botões de arenas diferentes: sem dedupe cruzado e cada clipe na própria arena/câmera", async () => {
  const db = await novoBanco();
  const montar = async () => {
    const arena = await criarArena(db);
    const quadra = await criarQuadra(db, arena.id);
    const camera = await criarCamera(db, arena.id, quadra.id);
    const botao = await criarBotao(db, arena.id, quadra.id, camera.id);
    return { arena, camera, botao };
  };
  const a = await montar(), b = await montar();
  const ra = await registrarAperto(db, a.botao.token);
  const rb = await registrarAperto(db, b.botao.token);
  expect(ra!.duplicado).toBe(false);
  expect(rb!.duplicado).toBe(false);
  expect(ra!.clipeId).not.toBe(rb!.clipeId);
  for (const [r, x] of [[ra, a], [rb, b]] as const) {
    const c = await db.query("select arena_id, camera_id from clipes where id = $1", [r!.clipeId]);
    expect(c.rows[0]).toEqual({ arena_id: x.arena.id, camera_id: x.camera.id });
  }
});

test("dois botões da mesma arena em quadras diferentes: dedupe é por botão", async () => {
  const db = await novoBanco();
  const arena = await criarArena(db);
  const montar = async () => {
    const quadra = await criarQuadra(db, arena.id);
    const camera = await criarCamera(db, arena.id, quadra.id);
    return criarBotao(db, arena.id, quadra.id, camera.id);
  };
  const b1 = await montar(), b2 = await montar();
  const r1 = await registrarAperto(db, b1.token);
  const r2 = await registrarAperto(db, b2.token);
  expect(r1!.duplicado).toBe(false);
  expect(r2!.duplicado).toBe(false);
  expect(r1!.clipeId).not.toBe(r2!.clipeId);
});

test("segundo aperto em menos de 5 s devolve o mesmo clipe com duplicado=true", async () => {
  const { db, botao } = await cenario();
  const a = await registrarAperto(db, botao.token);
  const b = await registrarAperto(db, botao.token);
  expect(b).toEqual({ clipeId: a!.clipeId, duplicado: true });
  expect((await db.query("select count(*)::int as n from clipes")).rows[0].n).toBe(1);
  expect((await db.query("select count(*)::int as n from apertos")).rows[0].n).toBe(1);
});

test("aperto duplicado também atualiza botoes.visto_em", async () => {
  const { db, botao } = await cenario();
  await registrarAperto(db, botao.token);
  await db.query("update botoes set visto_em = now() - interval '1 hour'");
  await registrarAperto(db, botao.token);
  const r = await db.query("select (visto_em > now() - interval '1 minute') as recente from botoes");
  expect(r.rows[0].recente).toBe(true);
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
  expect((await db.query("select count(*)::int as n from clipes")).rows[0].n).toBe(0);
  expect((await db.query("select visto_em from botoes")).rows[0].visto_em).toBeNull();
});

test("dias_retencao da arena define expira_em", async () => {
  const { db, botao } = await cenario(2);
  const r = await registrarAperto(db, botao.token);
  const c = await db.query(
    "select (expira_em - recebido_em = interval '2 days') as dois_dias from clipes where id = $1",
    [r!.clipeId]);
  expect(c.rows[0].dois_dias).toBe(true);
});

test("atualiza botoes.visto_em", async () => {
  const { db, botao } = await cenario();
  expect((await db.query("select visto_em from botoes")).rows[0].visto_em).toBeNull();
  await registrarAperto(db, botao.token);
  expect((await db.query("select visto_em from botoes")).rows[0].visto_em).not.toBeNull();
});

test("arena suspensa: aperto não grava nada e responde como token inválido; reativar volta a gravar", async () => {
  const { db, arena, botao } = await cenario();
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [arena.id]);
  expect(await registrarAperto(db, botao.token)).toBeNull();
  expect((await db.query("select 1 from apertos")).rows).toHaveLength(0);
  expect((await db.query("select 1 from clipes")).rows).toHaveLength(0);
  expect((await db.query("select visto_em from botoes")).rows).toEqual([{ visto_em: null }]);

  await db.query("update arenas set status_assinatura = 'ativa' where id = $1", [arena.id]);
  const r = await registrarAperto(db, botao.token);
  expect(r?.duplicado).toBe(false);
  expect((await db.query("select 1 from clipes")).rows).toHaveLength(1);
});

test("suspender só afeta a própria arena: o botão de outra arena segue gravando", async () => {
  const { db, arena, botao } = await cenario();
  const outra = await criarArena(db);
  const q = await criarQuadra(db, outra.id);
  const c = await criarCamera(db, outra.id, q.id);
  const b2 = await criarBotao(db, outra.id, q.id, c.id);
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [arena.id]);
  expect(await registrarAperto(db, botao.token)).toBeNull();
  expect((await registrarAperto(db, b2.token))?.duplicado).toBe(false);
});

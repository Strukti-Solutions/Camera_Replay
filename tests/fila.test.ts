import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { registrarAperto } from "../app/lib/aperto";
import { chaveDoClipe } from "../app/lib/r2";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

async function montar(db: Db) {
  const arena = await criarArena(db);
  const quadra = await criarQuadra(db, arena.id);
  const camera = await criarCamera(db, arena.id, quadra.id);
  const botao = await criarBotao(db, arena.id, quadra.id, camera.id);
  return { arena, camera, botao };
}

// Insere aperto + clipe com idade controlada (segundos desde recebido_em).
async function clipeCom(
  db: Db,
  c: { arena: { id: string }; camera: { id: string }; botao: { id: string } },
  idadeSeg: number,
  status = "pendente",
): Promise<string> {
  const a = await db.query<{ id: string }>(
    `insert into apertos (arena_id, botao_id, recebido_em)
     values ($1, $2, now() - make_interval(secs => $3)) returning id`,
    [c.arena.id, c.botao.id, idadeSeg],
  );
  const r = await db.query<{ id: string }>(
    `insert into clipes (arena_id, aperto_id, camera_id, status, recebido_em, expira_em)
     select arena_id, id, $2, $3, recebido_em, recebido_em + interval '7 days'
       from apertos where id = $1 returning id`,
    [a.rows[0].id, c.camera.id, status],
  );
  return r.rows[0].id;
}

const estado = async (db: Db, id: string) =>
  (
    await db.query(
      "select status, motivo, chave_r2, tamanho, duracao, iniciado_em from clipes where id = $1",
      [id],
    )
  ).rows[0];

test("pegar_clipes devolve só os da câmera pedida e passa para processando", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const b = await montar(db);
  const ra = await registrarAperto(db, a.botao.token);
  const rb = await registrarAperto(db, b.botao.token);
  const r = await db.query("select * from pegar_clipes($1, 10)", [a.camera.id]);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0]).toMatchObject({ clipe_id: ra!.clipeId, camera_id: a.camera.id });
  expect(r.rows[0].recebido_em).toBeInstanceOf(Date);
  const ea = await estado(db, ra!.clipeId);
  expect(ea.status).toBe("processando");
  expect(ea.iniciado_em).not.toBeNull();
  expect((await estado(db, rb!.clipeId)).status).toBe("pendente");
});

test("segunda chamada não devolve o mesmo clipe", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  await registrarAperto(db, a.botao.token);
  expect((await db.query("select * from pegar_clipes($1, 10)", [a.camera.id])).rows).toHaveLength(1);
  expect((await db.query("select * from pegar_clipes($1, 10)", [a.camera.id])).rows).toHaveLength(0);
});

test("respeita o limite e a ordem por recebido_em", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const novo = await clipeCom(db, a, 10);
  const velho = await clipeCom(db, a, 60);
  const meio = await clipeCom(db, a, 30);
  const r = await db.query("select * from pegar_clipes($1, 2)", [a.camera.id]);
  expect(r.rows.map((x: any) => x.clipe_id)).toEqual([velho, meio]);
  expect((await estado(db, novo)).status).toBe("pendente");
});

test("pegar_clipes não toca em clipe que não está pendente", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  await clipeCom(db, a, 10, "pronto");
  await clipeCom(db, a, 10, "falhou");
  expect((await db.query("select * from pegar_clipes($1, 10)", [a.camera.id])).rows).toHaveLength(0);
});

test("pegar_clipes devolve o arena_id do clipe (duas arenas)", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const b = await montar(db);
  const ra = await registrarAperto(db, a.botao.token);
  const rb = await registrarAperto(db, b.botao.token);
  const pa = await db.query("select * from pegar_clipes($1, 10)", [a.camera.id]);
  const pb = await db.query("select * from pegar_clipes($1, 10)", [b.camera.id]);
  expect(pa.rows).toHaveLength(1);
  expect(pa.rows[0]).toMatchObject({ clipe_id: ra!.clipeId, arena_id: a.arena.id });
  expect(pb.rows[0]).toMatchObject({ clipe_id: rb!.clipeId, arena_id: b.arena.id });
  expect(a.arena.id).not.toBe(b.arena.id);
});

test("marcar_pronto grava chave, tamanho, duração e status pronto", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipeCom(db, a, 5, "processando");
  const r = await db.query("select marcar_pronto($1, $2, $3, $4, false) as ok", [id, chaveDoClipe(a.arena.id, id), 1234, 30]);
  expect(r.rows[0].ok).toBe(true);
  const e = await estado(db, id);
  expect(e).toMatchObject({ status: "pronto", chave_r2: chaveDoClipe(a.arena.id, id), duracao: 30 });
  expect(String(e.tamanho)).toBe("1234");
});

test("marcar_pronto com parcial=true grava 'parcial'", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipeCom(db, a, 5, "processando");
  const r = await db.query("select marcar_pronto($1, $2, 10, 12.5, true) as ok", [id, chaveDoClipe(a.arena.id, id)]);
  expect(r.rows[0].ok).toBe(true);
  expect(await estado(db, id)).toMatchObject({ status: "parcial", duracao: 12.5 });
});

test("marcar_pronto em clipe já falhou devolve false e não muda nada (reaper venceu a corrida)", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipeCom(db, a, 200, "processando");
  expect((await db.query("select expirar_presos() as n")).rows[0].n).toBe(1);
  const antes = await estado(db, id);
  const r = await db.query("select marcar_pronto($1, $2, 10, 30, false) as ok", [id, chaveDoClipe(a.arena.id, id)]);
  expect(r.rows[0].ok).toBe(false);
  expect(await estado(db, id)).toEqual(antes);
  expect(antes).toMatchObject({ status: "falhou", chave_r2: null });
});

test("marcar_pronto em clipe pendente (nunca pego) ou inexistente devolve false", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipeCom(db, a, 5, "pendente");
  expect((await db.query("select marcar_pronto($1, $2, 1, 1, false) as ok", [id, chaveDoClipe(a.arena.id, id)])).rows[0].ok).toBe(false);
  expect((await estado(db, id)).status).toBe("pendente");
  const r = await db.query("select marcar_pronto(gen_random_uuid(), 'k', 1, 1, false) as ok");
  expect(r.rows[0].ok).toBe(false);
});

test("marcar_pronto lança com chave de outra arena, sem alterar o clipe", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const b = await montar(db);
  const id = await clipeCom(db, a, 5, "processando");
  await expect(
    db.query("select marcar_pronto($1, $2, 1, 1, false)", [id, chaveDoClipe(b.arena.id, id)]),
  ).rejects.toThrow(/chave/i);
  expect(await estado(db, id)).toMatchObject({ status: "processando", chave_r2: null });
});

test("marcar_pronto lança com clipe_id trocado na chave", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipeCom(db, a, 5, "processando");
  const outro = await clipeCom(db, a, 6, "processando");
  await expect(
    db.query("select marcar_pronto($1, $2, 1, 1, false)", [id, chaveDoClipe(a.arena.id, outro)]),
  ).rejects.toThrow(/chave/i);
  expect((await estado(db, id)).status).toBe("processando");
});

test("marcar_pronto lança com prefixo, extensão ou sufixo errados", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipeCom(db, a, 5, "processando");
  const certa = chaveDoClipe(a.arena.id, id);
  const erradas = [
    certa.replace("clipes/", "outros/"),
    certa.replace(".mp4", ".mov"),
    certa + "x",
    "/" + certa,
    "k",
    "",
  ];
  for (const k of erradas) {
    await expect(db.query("select marcar_pronto($1, $2, 1, 1, false)", [id, k])).rejects.toThrow(/chave/i);
  }
  expect((await estado(db, id)).status).toBe("processando");
});

test("marcar_pronto com chave errada lança mesmo se o clipe já não está em processando", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipeCom(db, a, 200, "processando");
  await db.query("select expirar_presos()");
  await expect(db.query("select marcar_pronto($1, 'k', 1, 1, false)", [id])).rejects.toThrow(/chave/i);
});

test("marcar_falhou grava motivo; em clipe pronto devolve false", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const p = await clipeCom(db, a, 5, "processando");
  expect((await db.query("select marcar_falhou($1, 'câmera offline') as ok", [p])).rows[0].ok).toBe(true);
  expect(await estado(db, p)).toMatchObject({ status: "falhou", motivo: "câmera offline" });
  const pronto = await clipeCom(db, a, 5, "pronto");
  expect((await db.query("select marcar_falhou($1, 'x') as ok", [pronto])).rows[0].ok).toBe(false);
  expect((await estado(db, pronto)).status).toBe("pronto");
});

test("expirar_presos marca só os com mais de 2 min (pendente e processando) e devolve a contagem", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const pend = await clipeCom(db, a, 180, "pendente");
  const proc = await clipeCom(db, a, 180, "processando");
  const recente = await clipeCom(db, a, 60, "pendente");
  expect((await db.query("select expirar_presos() as n")).rows[0].n).toBe(2);
  expect(await estado(db, pend)).toMatchObject({ status: "falhou", motivo: "tempo esgotado" });
  expect(await estado(db, proc)).toMatchObject({ status: "falhou", motivo: "tempo esgotado" });
  expect((await estado(db, recente)).status).toBe("pendente");
  expect((await db.query("select expirar_presos() as n")).rows[0].n).toBe(0);
});

test("expirar_presos não toca em clipe com ~110 s (fixa os 2 min pelos dois lados)", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const pend = await clipeCom(db, a, 110, "pendente");
  const proc = await clipeCom(db, a, 110, "processando");
  const velho = await clipeCom(db, a, 130, "pendente");
  expect((await db.query("select expirar_presos() as n")).rows[0].n).toBe(1);
  expect((await estado(db, pend)).status).toBe("pendente");
  expect((await estado(db, proc)).status).toBe("processando");
  expect((await estado(db, velho)).status).toBe("falhou");
});

test("expirar_presos conta de recebido_em, não de iniciado_em", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipeCom(db, a, 130, "pendente");
  await db.query("select * from pegar_clipes($1, 10)", [a.camera.id]); // iniciado_em = agora
  expect((await db.query("select expirar_presos() as n")).rows[0].n).toBe(1);
  expect((await estado(db, id)).status).toBe("falhou");
});

test("expirar_presos não toca em pronto, parcial nem falhou antigos", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const ids = [
    await clipeCom(db, a, 600, "pronto"),
    await clipeCom(db, a, 600, "parcial"),
    await clipeCom(db, a, 600, "falhou"),
  ];
  await db.query("update clipes set motivo = 'original' where status = 'falhou'");
  expect((await db.query("select expirar_presos() as n")).rows[0].n).toBe(0);
  const estados = await Promise.all(ids.map((i) => estado(db, i)));
  expect(estados.map((e) => e.status)).toEqual(["pronto", "parcial", "falhou"]);
  expect(estados[2].motivo).toBe("original");
});

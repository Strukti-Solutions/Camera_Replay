import { describe, expect, it } from "vitest";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

type Linha = { camera_id: string; arena_id: string; sn: string; credenciais: string };

describe("listar_cameras", () => {
  it("lista câmera com botão ativo, com arena_id, sn e credenciais", async () => {
    const db = await novoBanco();
    const a = await criarArena(db);
    const q = await criarQuadra(db, a.id);
    const c = await criarCamera(db, a.id, q.id);
    await criarBotao(db, a.id, q.id, c.id);
    const r = await db.query<Linha>("select * from listar_cameras()");
    expect(r.rows).toEqual([
      { camera_id: c.id, arena_id: a.id, sn: "SN0001", credenciais: "v1:x:x:x" },
    ]);
  });

  it("não lista câmera sem botão nem com botão só revogado", async () => {
    const db = await novoBanco();
    const a = await criarArena(db);
    const q = await criarQuadra(db, a.id);
    const semBotao = await criarCamera(db, a.id, q.id);
    const q2 = await criarQuadra(db, a.id);
    const revogada = await criarCamera(db, a.id, q2.id);
    const b = await criarBotao(db, a.id, q2.id, revogada.id);
    await db.query("update botoes set revogado_em = now() where id = $1", [b.id]);
    const r = await db.query<Linha>("select * from listar_cameras()");
    expect(r.rows).toEqual([]);
    expect(semBotao.id).not.toBe(revogada.id);
  });

  it("fluxo manual: religar o botão à câmera nova tira a antiga da lista", async () => {
    const db = await novoBanco();
    const a = await criarArena(db);
    const q = await criarQuadra(db, a.id);
    const antiga = await criarCamera(db, a.id, q.id);
    const botao = await criarBotao(db, a.id, q.id, antiga.id);
    const nova = await criarCamera(db, a.id, q.id);
    await db.query("update botoes set camera_id = $1 where id = $2", [nova.id, botao.id]);
    const r = await db.query<Linha>("select * from listar_cameras()");
    expect(r.rows.map((x) => x.camera_id)).toEqual([nova.id]);
  });

  it("duas arenas: cada câmera vem com o seu arena_id", async () => {
    const db = await novoBanco();
    const ids: { a: string; c: string }[] = [];
    for (const nome of ["A1", "A2"]) {
      const a = await criarArena(db, nome);
      const q = await criarQuadra(db, a.id);
      const c = await criarCamera(db, a.id, q.id);
      await criarBotao(db, a.id, q.id, c.id);
      ids.push({ a: a.id, c: c.id });
    }
    const r = await db.query<Linha>("select * from listar_cameras()");
    expect(r.rows.map((x) => [x.camera_id, x.arena_id]).sort()).toEqual(
      ids.map((x) => [x.c, x.a]).sort(),
    );
  });

  it("câmera com dois botões ativos aparece uma vez só", async () => {
    const db = await novoBanco();
    const a = await criarArena(db);
    const q = await criarQuadra(db, a.id);
    const c = await criarCamera(db, a.id, q.id);
    await criarBotao(db, a.id, q.id, c.id);
    await criarBotao(db, a.id, q.id, c.id);
    const r = await db.query<Linha>("select * from listar_cameras()");
    expect(r.rows).toHaveLength(1);
  });
});

describe("marcar_camera", () => {
  async function cameraNova() {
    const db = await novoBanco();
    const a = await criarArena(db);
    const q = await criarQuadra(db, a.id);
    const c = await criarCamera(db, a.id, q.id);
    return { db, id: c.id };
  }
  type Cam = { status: string; visto_em: Date | null };
  const ler = async (db: Awaited<ReturnType<typeof novoBanco>>, id: string) =>
    (await db.query<Cam>("select status, visto_em from cameras where id = $1", [id])).rows[0];

  it("'online' grava status e visto_em recente", async () => {
    const { db, id } = await cameraNova();
    const r = await db.query<{ marcar_camera: boolean }>("select marcar_camera($1, 'online')", [id]);
    expect(r.rows[0].marcar_camera).toBe(true);
    const cam = await ler(db, id);
    expect(cam.status).toBe("online");
    expect(Date.now() - new Date(cam.visto_em!).getTime()).toBeLessThan(10_000);
  });

  it("'offline' não mexe em visto_em", async () => {
    const { db, id } = await cameraNova();
    await db.query("select marcar_camera($1, 'online')", [id]);
    const antes = await ler(db, id);
    const r = await db.query<{ marcar_camera: boolean }>("select marcar_camera($1, 'offline')", [id]);
    expect(r.rows[0].marcar_camera).toBe(true);
    const depois = await ler(db, id);
    expect(depois.status).toBe("offline");
    expect(new Date(depois.visto_em!).getTime()).toBe(new Date(antes.visto_em!).getTime());
  });

  it("id inexistente devolve false", async () => {
    const { db } = await cameraNova();
    const r = await db.query<{ marcar_camera: boolean }>(
      "select marcar_camera('00000000-0000-0000-0000-000000000000', 'online')",
    );
    expect(r.rows[0].marcar_camera).toBe(false);
  });

  it("status inválido é recusado", async () => {
    const { db, id } = await cameraNova();
    await expect(db.query("select marcar_camera($1, 'xyz')", [id])).rejects.toThrow();
  });
});

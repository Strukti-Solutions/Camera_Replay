import type { Db } from "../app/lib/db";
import { hashToken, novoSlug, novoToken } from "../app/lib/segredos";

type Id = { id: string };

export async function criarArena(db: Db, nome = "Arena Teste"): Promise<Id> {
  const r = await db.query<Id>("insert into arenas (nome) values ($1) returning id", [nome]);
  return r.rows[0];
}

export async function criarQuadra(db: Db, arenaId: string): Promise<Id & { slug: string }> {
  const slug = novoSlug();
  const r = await db.query<Id>(
    "insert into quadras (arena_id, nome, slug) values ($1, 'Quadra 1', $2) returning id",
    [arenaId, slug],
  );
  return { id: r.rows[0].id, slug };
}

export async function criarCamera(db: Db, arenaId: string, quadraId: string): Promise<Id> {
  const r = await db.query<Id>(
    `insert into cameras (arena_id, quadra_id, nome, sn, credenciais)
     values ($1, $2, 'Camera 1', 'SN0001', 'v1:x:x:x') returning id`,
    [arenaId, quadraId],
  );
  return r.rows[0];
}

export async function criarBotao(
  db: Db, arenaId: string, quadraId: string, cameraId: string,
): Promise<Id & { token: string }> {
  const token = novoToken();
  const r = await db.query<Id>(
    `insert into botoes (arena_id, quadra_id, camera_id, token_hash)
     values ($1, $2, $3, $4) returning id`,
    [arenaId, quadraId, cameraId, hashToken(token)],
  );
  return { id: r.rows[0].id, token };
}

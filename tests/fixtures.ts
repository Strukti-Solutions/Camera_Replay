import type { Db } from "../app/lib/db";
import { criarHorarios } from "../app/lib/horarios-quadra";
import { hashToken, novoSlug, novoToken } from "../app/lib/segredos";

type Id = { id: string };

// Em bancos parados numa migração anterior à 0008 a coluna slug ainda não existe.
export async function criarArena(db: Db, nome = "Arena Teste"): Promise<Id & { slug: string }> {
  const slug = novoSlug();
  const tem = await db.query(
    "select 1 from information_schema.columns where table_name = 'arenas' and column_name = 'slug'");
  if (tem.rows.length === 0) {
    const r = await db.query<Id>("insert into arenas (nome) values ($1) returning id", [nome]);
    return { id: r.rows[0].id, slug: "" };
  }
  const r = await db.query<Id>("insert into arenas (nome, slug) values ($1, $2) returning id", [nome, slug]);
  return { id: r.rows[0].id, slug };
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

// Um horário de 1 hora para cada hora cheia de `deHora` a `ateHora`, nos dias da semana dados.
export async function criarHorariosDeHora(
  db: Db, arenaId: string, quadraId: string, dias: number[], deHora: number, ateHora: number, precoCentavos: number,
): Promise<void> {
  const novos = dias.flatMap((diaSemana) =>
    Array.from({ length: ateHora - deHora }, (_, i) => ({
      diaSemana, inicio: (deHora + i) * 60, fim: (deHora + i + 1) * 60, precoCentavos,
    })),
  );
  const r = await criarHorarios(db, arenaId, quadraId, novos);
  if (!r.ok) throw new Error(r.erro);
}

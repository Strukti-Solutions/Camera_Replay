import type { Db } from "./db";

export type ClipePublico = {
  id: string;
  recebidoEm: Date;
  duracao: number;
  parcial: boolean;
  url: string;
};

export type LeitorR2 = { urlLeitura(chave: string): Promise<string> };

const SLUG_VALIDO = /^[A-Za-z0-9_-]{20,}$/;
const LIMITE = 50;

// Lista pública da quadra, aberta por /q/<slug>. O slug é o único acesso.
// Devolve null para slug malformado (sem tocar no banco) ou desconhecido.
// Clipes não têm quadra_id: a ligação é pela câmera, e a consulta filtra por
// quadra_id e arena_id. Nunca expõe motivo, chave_r2, camera_id nem dados da
// arena; só o id do clipe, que a página usa como chave de lista.
export async function clipesDaQuadra(
  db: Db,
  r2: LeitorR2,
  slug: string,
): Promise<{ quadra: string; clipes: ClipePublico[] } | null> {
  if (typeof slug !== "string" || !SLUG_VALIDO.test(slug)) return null;

  const q = await db.query<{ id: string; arena_id: string; nome: string }>(
    "select id, arena_id, nome from quadras where slug = $1",
    [slug],
  );
  const quadra = q.rows[0];
  if (!quadra) return null;

  const { rows } = await db.query<{
    id: string;
    recebido_em: Date;
    duracao: number | null;
    status: string;
    chave_r2: string;
  }>(
    `select c.id, c.recebido_em, c.duracao, c.status, c.chave_r2
       from clipes c
       join cameras cam on cam.id = c.camera_id and cam.arena_id = c.arena_id
      where cam.quadra_id = $1
        and cam.arena_id = $2
        and c.arena_id = $2
        and c.status in ('pronto', 'parcial')
        and c.chave_r2 is not null
        and c.expira_em > now()
      order by c.recebido_em desc, c.id
      limit $3`,
    [quadra.id, quadra.arena_id, LIMITE],
  );

  const clipes = await Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      recebidoEm: c.recebido_em,
      duracao: Number(c.duracao ?? 0),
      parcial: c.status === "parcial",
      url: await r2.urlLeitura(c.chave_r2),
    })),
  );
  return { quadra: quadra.nome, clipes };
}

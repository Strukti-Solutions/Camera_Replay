import type { Db } from "./db";
import { SLUG_VALIDO } from "./clipes";

// Resolução de slugs: da arena (QR geral), da quadra (QRs antigos /q/<slug>) e o
// caminho inverso, do id da arena do painel para o slug dela.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

type Arena = { id: string; nome: string; status: string };

// Slug malformado nunca toca o banco; desconhecido devolve null.
async function arenaPorSlug(db: Db, slug: string): Promise<Arena | null> {
  if (typeof slug !== "string" || !SLUG_VALIDO.test(slug)) return null;
  const q = await db.query<Arena>("select id, nome, status_assinatura as status from arenas where slug = $1", [slug]);
  return q.rows[0] ?? null;
}

// "ativa" deixa a página da arena trocar o formulário pelo aviso de arena
// suspensa; o status cru (e qualquer outro dado da assinatura) não sai daqui.
export async function arenaDoSlug(
  db: Db,
  slug: string,
): Promise<{ arenaId: string; nome: string; ativa: boolean } | null> {
  const a = await arenaPorSlug(db, slug);
  return a ? { arenaId: a.id, nome: a.nome, ativa: a.status === "ativa" } : null;
}

// Slug da arena a que a quadra pertence, para as rotas antigas /q/<slug-da-quadra>
// redirecionarem. Slug malformado não toca o banco.
export async function slugDaArenaDaQuadra(db: Db, slugQuadra: string): Promise<string | null> {
  if (typeof slugQuadra !== "string" || !SLUG_VALIDO.test(slugQuadra)) return null;
  const q = await db.query<{ slug: string }>(
    "select a.slug from quadras q join arenas a on a.id = q.arena_id where q.slug = $1",
    [slugQuadra],
  );
  return q.rows[0]?.slug ?? null;
}

// Slug da arena da sessão do dono, para o QR geral do painel. Id fora do formato
// uuid não toca o banco.
export async function slugDaArena(db: Db, arenaId: string): Promise<string | null> {
  if (!ehUuid(arenaId)) return null;
  const q = await db.query<{ slug: string }>("select slug from arenas where id = $1", [arenaId]);
  return q.rows[0]?.slug ?? null;
}

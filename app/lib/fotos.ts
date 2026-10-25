import { randomUUID } from "node:crypto";
import { emTransacao, type Db } from "./db";

// Fotos da arena (quadra_id nulo) e das quadras. Sempre recebe o arena_id da
// sessão: foto ou quadra de outra arena se comporta como inexistente. O envio
// ao R2 fica fora daqui (fotos-envio.ts); esta parte só cuida das linhas.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

export const FOTOS_MAX_ARENA = 10;
export const FOTOS_MAX_QUADRA = 6;
export const FOTO_MAX_BYTES = 2 * 1024 * 1024;

export type TipoFoto = "image/jpeg" | "image/png" | "image/webp";
export type Foto = { id: string; tipo: TipoFoto; bytes: number; posicao: number };

const comeca = (b: Uint8Array, assinatura: number[], desde = 0) =>
  b.length >= desde + assinatura.length && assinatura.every((x, i) => b[desde + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

// O formato vem dos primeiros bytes; o nome e o tipo do navegador não contam.
export function tipoDaImagem(b: Uint8Array): TipoFoto | null {
  if (comeca(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (comeca(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (comeca(b, ascii("RIFF")) && comeca(b, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

export function extensaoDoTipo(tipo: TipoFoto): "jpg" | "png" | "webp" {
  return tipo === "image/jpeg" ? "jpg" : tipo === "image/png" ? "png" : "webp";
}

// Mesmo grupo de fotos: as da arena (quadra nula) ou as de uma quadra.
const DO_GRUPO = "arena_id = $1 and quadra_id is not distinct from $2";

export async function listarFotos(db: Pick<Db, "query">, arenaId: string, quadraId: string | null): Promise<Foto[]> {
  if (!ehUuid(arenaId) || (quadraId !== null && !ehUuid(quadraId))) return [];
  const { rows } = await db.query<Foto>(
    `select id, tipo, bytes, posicao from fotos where ${DO_GRUPO} order by posicao, criado_em, id`,
    [arenaId, quadraId],
  );
  return rows.map((r) => ({ id: r.id, tipo: r.tipo, bytes: Number(r.bytes), posicao: Number(r.posicao) }));
}

// Grava a linha da foto. O envio ao R2 vem depois; se falhar, quem chamou apaga
// a linha. A trava na arena faz dois envios simultâneos contarem um depois do outro.
export async function reservarFoto(
  db: Db, arenaId: string, quadraId: string | null, tipo: TipoFoto, bytes: number,
): Promise<{ ok: true; id: string; chave: string } | { ok: false; erro: string }> {
  if (!ehUuid(arenaId)) return { ok: false, erro: "Arena não encontrada." };
  if (quadraId !== null && !ehUuid(quadraId)) return { ok: false, erro: "Quadra não encontrada." };
  return emTransacao(db, async (tx) => {
    const a = await travarArena(tx, arenaId);
    if (a.rows.length === 0) return { ok: false as const, erro: "Arena não encontrada." };
    if (quadraId !== null) {
      const q = await tx.query("select 1 from quadras where id = $1 and arena_id = $2", [quadraId, arenaId]);
      if (q.rows.length === 0) return { ok: false as const, erro: "Quadra não encontrada." };
    }
    const c = await tx.query<{ n: number }>(`select count(*)::int as n from fotos where ${DO_GRUPO}`, [arenaId, quadraId]);
    const n = Number(c.rows[0].n);
    if (quadraId === null && n >= FOTOS_MAX_ARENA) return { ok: false as const, erro: `A arena já tem ${FOTOS_MAX_ARENA} fotos.` };
    if (quadraId !== null && n >= FOTOS_MAX_QUADRA) return { ok: false as const, erro: `A quadra já tem ${FOTOS_MAX_QUADRA} fotos.` };
    const id = randomUUID();
    const chave = `fotos/${arenaId}/${id}.${extensaoDoTipo(tipo)}`;
    await tx.query(
      "insert into fotos (id, arena_id, quadra_id, chave, tipo, bytes, posicao) values ($1, $2, $3, $4, $5, $6, $7)",
      [id, arenaId, quadraId, chave, tipo, bytes, n],
    );
    return { ok: true as const, id, chave };
  });
}

type Linha = { id: string; quadra_id: string | null; chave: string };

async function fotoDaArena(tx: Pick<Db, "query">, arenaId: string, fotoId: string): Promise<Linha | null> {
  if (!ehUuid(arenaId) || !ehUuid(fotoId)) return null;
  const { rows } = await tx.query<Linha>(
    "select id, quadra_id, chave from fotos where id = $1 and arena_id = $2",
    [fotoId, arenaId],
  );
  return rows[0] ?? null;
}

// Toda mudança nas fotos da arena passa pela mesma fila (a mesma trava do envio):
// dois "mover" ou "apagar + enviar" ao mesmo tempo não se atropelam.
const travarArena = (tx: Pick<Db, "query">, arenaId: string) =>
  tx.query("select 1 from arenas where id = $1 for no key update", [arenaId]);

const idsDoGrupo = async (tx: Pick<Db, "query">, arenaId: string, quadraId: string | null) =>
  (await listarFotos(tx, arenaId, quadraId)).map((f) => f.id);

// Renumera o grupo de 0 a n-1 na ordem de `ids` (ordinality começa em 1).
const gravarOrdem = (tx: Pick<Db, "query">, ids: string[]) =>
  tx.query(
    "update fotos f set posicao = t.p - 1 from unnest($1::uuid[]) with ordinality as t(id, p) where f.id = t.id",
    [ids],
  );

// Apaga primeiro no R2 (se lançar, a linha fica e o erro sobe) e depois a linha.
// A leitura da chave fica fora da transação para não segurar a trava durante o R2.
export async function apagarFoto(
  db: Db, apagarNoR2: (chave: string) => Promise<void>, arenaId: string, fotoId: string,
): Promise<boolean> {
  const foto = await fotoDaArena(db, arenaId, fotoId);
  if (!foto) return false;
  await apagarNoR2(foto.chave);
  return emTransacao(db, async (tx) => {
    await travarArena(tx, arenaId);
    const r = await tx.query<{ id: string }>("delete from fotos where id = $1 and arena_id = $2 returning id", [fotoId, arenaId]);
    const ids = await idsDoGrupo(tx, arenaId, foto.quadra_id);
    if (ids.length > 0) await gravarOrdem(tx, ids);
    return r.rows.length > 0;
  });
}

async function reordenar(
  db: Db, arenaId: string, fotoId: string, nova: (ids: string[], i: number) => string[] | null,
): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(fotoId)) return false;
  return emTransacao(db, async (tx) => {
    await travarArena(tx, arenaId);
    const foto = await fotoDaArena(tx, arenaId, fotoId);
    if (!foto) return false;
    const ids = await idsDoGrupo(tx, arenaId, foto.quadra_id);
    const ordem = nova(ids, ids.indexOf(fotoId));
    if (!ordem) return false;
    await gravarOrdem(tx, ordem);
    return true;
  });
}

// Troca com a vizinha; nas pontas não faz nada.
export function moverFoto(db: Db, arenaId: string, fotoId: string, direcao: -1 | 1): Promise<boolean> {
  return reordenar(db, arenaId, fotoId, (ids, i) => {
    const j = i + direcao;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    const ordem = [...ids];
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
    return ordem;
  });
}

// Vai para a posição 0; as outras mantêm a ordem entre si.
export function usarComoCapa(db: Db, arenaId: string, fotoId: string): Promise<boolean> {
  return reordenar(db, arenaId, fotoId, (ids, i) => (i <= 0 ? null : [ids[i], ...ids.filter((_, k) => k !== i)]));
}

// Foto pública (divulgação): só pelo id, e só de arena ativa (suspensa sai da vitrine).
// `qualquerArena` é só para a rota do super admin, que vê também as suspensas.
export async function fotoParaServir(
  db: Pick<Db, "query">, fotoId: string, qualquerArena = false,
): Promise<{ chave: string; tipo: TipoFoto } | null> {
  if (!ehUuid(fotoId)) return null;
  const { rows } = await db.query<{ chave: string; tipo: TipoFoto }>(
    `select f.chave, f.tipo from fotos f join arenas a on a.id = f.arena_id
      where f.id = $1 and ($2 or a.status_assinatura = 'ativa')`,
    [fotoId, qualquerArena],
  );
  return rows[0] ?? null;
}

export async function capaDaArena(db: Pick<Db, "query">, arenaId: string): Promise<string | null> {
  return (await listarFotos(db, arenaId, null))[0]?.id ?? null;
}

// Capa de cada quadra da arena que tem foto, numa consulta só.
export async function capasDasQuadras(db: Pick<Db, "query">, arenaId: string): Promise<Map<string, string>> {
  if (!ehUuid(arenaId)) return new Map();
  const { rows } = await db.query<{ quadra_id: string; id: string }>(
    `select distinct on (quadra_id) quadra_id, id from fotos
      where arena_id = $1 and quadra_id is not null
      order by quadra_id, posicao, criado_em, id`,
    [arenaId],
  );
  return new Map(rows.map((r) => [r.quadra_id, r.id]));
}

import type { Db } from "./db";
import type { HorarioComId } from "./horarios";
import { listarHorarios } from "./horarios-quadra";
import { SLUG_VALIDO } from "./clipes";
import type { Periodo } from "./disponibilidade";
import { capasDasQuadras, listarFotos } from "./fotos";
import { periodosOcupadosEntre } from "./reservas";
import { normalizar, sqlNorm } from "./texto-busca";

// Dados públicos das arenas (home, busca, mapa e /a/<slug>). Fica fora de
// plataforma.ts de propósito: é o dado que cruza arenas sem sessão. Só sai o que
// é de vitrine: nome, slug, endereço, coordenadas, quadras e horários
// (nada de dono, taxa, câmeras ou contagens).

export const LIMITE_PUBLICO = 50;
export const LIMITE_SUGESTOES = 8;

const CAMPOS_BUSCA = ["nome", "endereco_rua", "endereco_bairro", "endereco_cidade", "endereco_uf"];
// position() mantém % e _ como texto literal. O alvo junta os campos com \n,
// que o termo (aparado, de uma linha) não atravessa por acaso.
const ALVO_BUSCA = CAMPOS_BUSCA.map(sqlNorm).join(" || E'\n' || ");

type ArenaLista = { nome: string; slug: string; cidade: string | null };

async function buscar(db: Db, termo: string, limite: number): Promise<ArenaLista[]> {
  const { rows } = await db.query<ArenaLista>(
    `select nome, slug, endereco_cidade as cidade from arenas
      where status_assinatura = 'ativa'
        and ($1 = '' or position($1 in ${ALVO_BUSCA}) > 0)
      order by nome, id
      limit ${limite}`,
    [termo],
  );
  return rows.map((r) => ({ nome: r.nome, slug: r.slug, cidade: r.cidade || null }));
}

// Arenas ativas, por nome, até 50, casando nome, rua, bairro, cidade e UF sem
// acento e sem diferença de maiúscula.
export function listarArenasPublicas(db: Db, busca?: string): Promise<ArenaLista[]> {
  return buscar(db, normalizar(busca), LIMITE_PUBLICO);
}

// Sugestões da busca: 2 a 80 caracteres (o que sobra do aparo); menos que isso
// ou mais que isso devolve [] sem consultar o banco.
export async function sugestoesArenas(db: Db, termo: string): Promise<ArenaLista[]> {
  if (typeof termo !== "string") return [];
  const limpo = termo.replace(/\u0000/g, "").trim();
  if (limpo.length > 80) return [];
  const norm = normalizar(limpo);
  // O tamanho mínimo vale sobre o termo normalizado: só marcas combinantes não lista tudo.
  if (norm.length < 2) return [];
  return buscar(db, norm, LIMITE_SUGESTOES);
}

// ---------- Cards da home ----------

export type CartaoArena = {
  nome: string;
  slug: string;
  bairro: string | null;
  cidade: string | null;
  latitude: number | null;
  longitude: number | null;
  fotos: string[]; // até 5 fotos da arena (não das quadras), a capa primeiro
  aPartirDe: number | null; // menor preço entre os horários (centavos)
  porHora: boolean; // todos os horários têm 1 h: o preço vira "/h"
  esportes: string[];
};

const FOTOS_NO_CARTAO = 5;

// Esportes sem repetir pela forma normalizada; entre grafias iguais vale a que
// começa com maiúscula. Ordem alfabética.
function esportesUnicos(lista: string[]): string[] {
  const porChave = new Map<string, string>();
  for (const cru of lista) {
    const e = cru.normalize("NFC");
    const chave = normalizar(e);
    if (!chave) continue;
    const atual = porChave.get(chave);
    if (atual === undefined || (atual[0] !== atual[0].toUpperCase() && e[0] === e[0].toUpperCase())) porChave.set(chave, e);
  }
  return [...porChave.values()].sort((x, y) => x.localeCompare(y, "pt-BR"));
}

// Cards da home: arenas ativas por nome, até 50. A busca casa nome, endereço e
// esporte das quadras; o esporte filtra pela quadra (sem acento e sem maiúscula).
// Fotos, preços e esportes vêm em lote, nunca uma consulta por arena.
export async function cartoesDeArenas(db: Db, f: { busca?: string; esporte?: string }): Promise<CartaoArena[]> {
  const termo = normalizar(f.busca);
  const esporte = normalizar(f.esporte);
  const { rows } = await db.query<{
    id: string; nome: string; slug: string; bairro: string | null; cidade: string | null;
    latitude: number | null; longitude: number | null;
  }>(
    `select a.id, a.nome, a.slug, a.endereco_bairro as bairro, a.endereco_cidade as cidade, a.latitude, a.longitude
       from arenas a
      where a.status_assinatura = 'ativa'
        and ($1 = '' or position($1 in ${ALVO_BUSCA}) > 0
             or exists (select 1 from quadras q where q.arena_id = a.id and position($1 in ${sqlNorm("q.esporte")}) > 0))
        and ($2 = '' or exists (select 1 from quadras q where q.arena_id = a.id and ${sqlNorm("q.esporte")} = $2))
      order by a.nome, a.id
      limit ${LIMITE_PUBLICO}`,
    [termo, esporte],
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [fotos, precos, esportes] = await Promise.all([
    db.query<{ arena_id: string; id: string }>(
      `select arena_id, id from fotos where arena_id = any($1::uuid[]) and quadra_id is null order by arena_id, posicao, criado_em, id`,
      [ids],
    ),
    db.query<{ arena_id: string; minimo: number; por_hora: boolean }>(
      `select arena_id, min(preco_centavos)::int as minimo, bool_and(fim - inicio = 60) as por_hora
         from horarios_quadra where arena_id = any($1::uuid[]) group by arena_id`,
      [ids],
    ),
    db.query<{ arena_id: string; esporte: string }>(
      `select arena_id, esporte from quadras where arena_id = any($1::uuid[]) and esporte <> ''`,
      [ids],
    ),
  ]);
  const fotosPor = new Map<string, string[]>();
  for (const r of fotos.rows) {
    const l = fotosPor.get(r.arena_id) ?? [];
    if (l.length < FOTOS_NO_CARTAO) l.push(r.id);
    fotosPor.set(r.arena_id, l);
  }
  const precoPor = new Map(precos.rows.map((r) => [r.arena_id, r]));
  const esportesPor = new Map<string, string[]>();
  for (const r of esportes.rows) esportesPor.set(r.arena_id, [...(esportesPor.get(r.arena_id) ?? []), r.esporte]);
  return rows.map((r) => {
    const p = precoPor.get(r.id);
    return {
      nome: r.nome,
      slug: r.slug,
      bairro: r.bairro || null,
      cidade: r.cidade || null,
      latitude: r.latitude === null ? null : Number(r.latitude),
      longitude: r.longitude === null ? null : Number(r.longitude),
      fotos: fotosPor.get(r.id) ?? [],
      aPartirDe: p ? Number(p.minimo) : null,
      porHora: p ? p.por_hora === true : false,
      esportes: esportesUnicos(esportesPor.get(r.id) ?? []),
    };
  });
}

// Esportes do filtro da home: os das quadras de arenas ativas, sem repetir.
export async function esportesDasArenas(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ esporte: string }>(
    `select distinct q.esporte from quadras q join arenas a on a.id = q.arena_id
      where a.status_assinatura = 'ativa' and q.esporte <> ''`,
  );
  return esportesUnicos(rows.map((r) => r.esporte));
}

// Pontos do mapa: arenas ativas com latitude e longitude.
export async function arenasNoMapa(
  db: Db,
): Promise<{ nome: string; slug: string; latitude: number; longitude: number }[]> {
  const { rows } = await db.query<{ nome: string; slug: string; latitude: number; longitude: number }>(
    `select nome, slug, latitude, longitude from arenas
      where status_assinatura = 'ativa' and latitude is not null and longitude is not null
      order by nome, id`,
  );
  return rows.map((r) => ({ nome: r.nome, slug: r.slug, latitude: Number(r.latitude), longitude: Number(r.longitude) }));
}

export type ArenaPublica = {
  nome: string;
  slug: string;
  ativa: boolean;
  endereco: { rua: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null } | null;
  latitude: number | null;
  longitude: number | null;
  fotos: string[]; // ids das fotos da arena, a capa primeiro
  quadras: {
    id: string; nome: string; esporte: string; horarios: HorarioComId[];
    capaId: string | null;
    aPartirDe: number | null; // menor preço entre os horários (centavos)
  }[];
};

// Página pública da arena. Slug malformado não toca o banco; arena suspensa sai
// sem quadras.
export async function arenaPublica(db: Db, slug: string): Promise<ArenaPublica | null> {
  if (typeof slug !== "string" || !SLUG_VALIDO.test(slug)) return null;
  const a = await db.query<{
    id: string; nome: string; slug: string; status: string;
    rua: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null;
    latitude: number | null; longitude: number | null;
  }>(
    `select id, nome, slug, status_assinatura as status, endereco_rua as rua, endereco_numero as numero,
            endereco_bairro as bairro, endereco_cidade as cidade, endereco_uf as uf, endereco_cep as cep,
            latitude, longitude
       from arenas where slug = $1`,
    [slug],
  );
  const r = a.rows[0];
  if (!r) return null;
  const ativa = r.status === "ativa";
  const endereco = { rua: r.rua, numero: r.numero, bairro: r.bairro, cidade: r.cidade, uf: r.uf, cep: r.cep };
  const temEndereco = Object.values(endereco).some((v) => v !== null && v !== "");
  const base = {
    nome: r.nome,
    slug: r.slug,
    ativa,
    endereco: temEndereco ? endereco : null,
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
  };
  if (!ativa) return { ...base, fotos: [], quadras: [] };

  const [q, fotos, capas] = await Promise.all([
    db.query<{ id: string; nome: string; esporte: string }>(
      "select id, nome, esporte from quadras where arena_id = $1 order by nome, id",
      [r.id],
    ),
    listarFotos(db, r.id, null),
    capasDasQuadras(db, r.id),
  ]);
  const quadras = await Promise.all(
    q.rows.map(async (x) => {
      const horarios = await listarHorarios(db, r.id, x.id);
      return {
        id: x.id, nome: x.nome, esporte: x.esporte, horarios,
        capaId: capas.get(x.id) ?? null,
        aPartirDe: horarios.length > 0 ? Math.min(...horarios.map((h) => h.precoCentavos)) : null,
      };
    }),
  );
  return { ...base, fotos: fotos.map((f) => f.id), quadras };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

// Slug da arena dona da quadra (para /reservar voltar à página certa). Id que
// não é uuid não toca o banco.
export async function slugDaQuadra(db: Db, quadraId: string): Promise<string | null> {
  if (!ehUuid(quadraId)) return null;
  const { rows } = await db.query<{ slug: string }>(
    "select a.slug from quadras q join arenas a on a.id = q.arena_id where q.id = $1",
    [quadraId],
  );
  return rows[0]?.slug ?? null;
}

// Períodos do dia já tomados por reserva ou bloqueio na quadra. Só início e fim:
// quem reservou não sai daqui.
export async function periodosPublicos(db: Db, quadraId: string, dia: string): Promise<Periodo[]> {
  return periodosPublicosEntre(db, quadraId, dia, dia);
}

const DIA_AAAA_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

// O mesmo para os dias locais de `de` a `ate` (o calendário da janela inteira).
export async function periodosPublicosEntre(db: Db, quadraId: string, de: string, ate: string): Promise<Periodo[]> {
  if (!ehUuid(quadraId) || !DIA_AAAA_MM_DD.test(String(de)) || !DIA_AAAA_MM_DD.test(String(ate))) return [];
  const q = await db.query<{ arena_id: string }>("select arena_id from quadras where id = $1", [quadraId]);
  const arenaId = q.rows[0]?.arena_id;
  if (!arenaId) return [];
  return (await periodosOcupadosEntre(db, arenaId, quadraId, de, ate)).map((p) => ({ inicio: p.inicio, fim: p.fim }));
}

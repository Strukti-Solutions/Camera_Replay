import type { Db } from "./db";
import type { HorarioComId } from "./horarios";
import { listarHorarios } from "./horarios-quadra";
import { SLUG_VALIDO } from "./clipes";
import type { Periodo } from "./disponibilidade";
import { periodosOcupados } from "./reservas";

// Dados públicos das arenas (home, busca, mapa e /a/<slug>). Fica fora de
// plataforma.ts de propósito: é o dado que cruza arenas sem sessão. Só sai o que
// é de vitrine: nome, slug, endereço, coordenadas, quadras e horários
// (nada de dono, taxa, câmeras ou contagens).

export const LIMITE_PUBLICO = 50;
export const LIMITE_SUGESTOES = 8;

// Minúsculas e maiúsculas na tabela: não depende da localidade do banco para o lower() das maiúsculas acentuadas.
const ACENTOS = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuucn".repeat(2);

// Termo sem NUL (o Postgres recusa), aparado, até 80 caracteres, minúsculo e sem
// acento. Os dois lados da comparação passam pela mesma normalização.
function normalizar(busca: unknown): string {
  if (typeof busca !== "string") return "";
  return busca
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Expressão SQL equivalente para uma coluna de texto (nula vira vazio).
const sqlNorm = (col: string) => `translate(lower(coalesce(${col}, '')), '${ACENTOS}', '${SEM_ACENTO}')`;

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
  quadras: { id: string; nome: string; esporte: string; horarios: HorarioComId[] }[];
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
  if (!ativa) return { ...base, quadras: [] };

  const q = await db.query<{ id: string; nome: string; esporte: string }>(
    "select id, nome, esporte from quadras where arena_id = $1 order by nome, id",
    [r.id],
  );
  const quadras = await Promise.all(
    q.rows.map(async (x) => ({
      id: x.id, nome: x.nome, esporte: x.esporte, horarios: await listarHorarios(db, r.id, x.id),
    })),
  );
  return { ...base, quadras };
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
  if (!ehUuid(quadraId)) return [];
  const q = await db.query<{ arena_id: string }>("select arena_id from quadras where id = $1", [quadraId]);
  const arenaId = q.rows[0]?.arena_id;
  if (!arenaId) return [];
  return (await periodosOcupados(db, arenaId, quadraId, dia)).map((p) => ({ inicio: p.inicio, fim: p.fim }));
}

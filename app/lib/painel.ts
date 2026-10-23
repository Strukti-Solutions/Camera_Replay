import { z } from "zod";
import type { Db } from "./db";
import { cifrarCredenciais } from "./cripto";
import { novoSlug, novoToken, hashToken } from "./segredos";
import { chaveDaCapa, chaveDoClipe } from "./r2";
import type { LeitorR2 } from "./clipes";
import type { ApagadorR2 } from "./limpeza";

// Funções do painel do dono. Todas recebem o arena_id da sessão (nunca de campo
// de formulário) e filtram por ele em toda consulta: um id de outra arena
// se comporta como inexistente. Nada aqui devolve credenciais nem token_hash.

// Erro com mensagem pronta para mostrar ao dono.
export class ErroPainel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroPainel";
  }
}

export type CameraPainel = { id: string; nome: string; sn: string; online: boolean; vistoEm: Date | null };

export type ClipePainel = {
  id: string;
  recebidoEm: Date;
  status: "pendente" | "processando" | "pronto" | "parcial" | "falhou";
  motivo: string | null;
  duracao: number | null;
  url: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Id malformado nunca vai ao banco (o Postgres erraria com 22P02 e eco da entrada):
// vale como inexistente.
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

// Câmera conta como online se o worker se anunciou nos últimos 60 s.
const JANELA_ONLINE_SEG = 60;
const LIMITE_CLIPES = 50;

type LinhaCamera = {
  cam_id: string | null;
  cam_nome: string | null;
  cam_sn: string | null;
  cam_online: boolean | null;
  cam_visto_em: Date | null;
};

// Colunas da câmera mais recente da quadra (join lateral, alias "cam").
const COLUNAS_CAMERA = `cam.id as cam_id, cam.nome as cam_nome, cam.sn as cam_sn,
  (cam.status = 'online' and cam.visto_em is not null
    and cam.visto_em > now() - make_interval(secs => ${JANELA_ONLINE_SEG})) as cam_online,
  cam.visto_em as cam_visto_em`;

const CAMERA_RECENTE = `left join lateral (
    select * from cameras c
     where c.quadra_id = q.id and c.arena_id = q.arena_id
     order by c.criado_em desc, c.id
     limit 1
  ) cam on true`;

function paraCamera(l: LinhaCamera): CameraPainel | null {
  if (!l.cam_id) return null;
  return {
    id: l.cam_id,
    nome: l.cam_nome as string,
    sn: l.cam_sn as string,
    online: Boolean(l.cam_online),
    vistoEm: l.cam_visto_em,
  };
}

export async function listarQuadras(
  db: Db,
  arenaId: string,
): Promise<{ id: string; nome: string; slug: string; camera: CameraPainel | null; botoesAtivos: number }[]> {
  if (!ehUuid(arenaId)) return [];
  const { rows } = await db.query<LinhaCamera & { id: string; nome: string; slug: string; botoes_ativos: number }>(
    `select q.id, q.nome, q.slug, ${COLUNAS_CAMERA},
            (select count(*) from botoes b
              where b.quadra_id = q.id and b.arena_id = q.arena_id and b.revogado_em is null)::int as botoes_ativos
       from quadras q
       ${CAMERA_RECENTE}
      where q.arena_id = $1
      order by q.nome, q.id`,
    [arenaId],
  );
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    slug: r.slug,
    camera: paraCamera(r),
    botoesAtivos: Number(r.botoes_ativos),
  }));
}

export async function detalheQuadra(
  db: Db,
  arenaId: string,
  quadraId: string,
): Promise<{
  id: string;
  nome: string;
  slug: string;
  camera: CameraPainel | null;
  botoes: { id: string; criadoEm: Date; vistoEm: Date | null; revogadoEm: Date | null }[];
} | null> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return null;
  const { rows } = await db.query<LinhaCamera & { id: string; nome: string; slug: string }>(
    `select q.id, q.nome, q.slug, ${COLUNAS_CAMERA}
       from quadras q
       ${CAMERA_RECENTE}
      where q.id = $1 and q.arena_id = $2`,
    [quadraId, arenaId],
  );
  const q = rows[0];
  if (!q) return null;

  const b = await db.query<{ id: string; criado_em: Date; visto_em: Date | null; revogado_em: Date | null }>(
    `select id, criado_em, visto_em, revogado_em from botoes
      where quadra_id = $1 and arena_id = $2
      order by criado_em, id`,
    [quadraId, arenaId],
  );
  return {
    id: q.id,
    nome: q.nome,
    slug: q.slug,
    camera: paraCamera(q),
    botoes: b.rows.map((x) => ({
      id: x.id,
      criadoEm: x.criado_em,
      vistoEm: x.visto_em,
      revogadoEm: x.revogado_em,
    })),
  };
}

export async function criarQuadra(
  db: Db,
  arenaId: string,
  nome: string,
): Promise<{ id: string; slug: string }> {
  const limpo = typeof nome === "string" ? nome.trim() : "";
  if (limpo.length < 1 || limpo.length > 60) {
    throw new ErroPainel("nome inválido");
  }
  if (!ehUuid(arenaId)) throw new ErroPainel("arena inválida");
  const slug = novoSlug();
  const r = await db.query<{ id: string }>(
    "insert into quadras (arena_id, nome, slug) values ($1, $2, $3) returning id",
    [arenaId, limpo, slug],
  );
  return { id: r.rows[0].id, slug };
}

const texto = z.string().trim().min(1).max(200);
const esquemaCredenciais = z.object({
  authcode: texto,
  local_user: texto,
  // A senha não leva trim: espaços podem fazer parte dela.
  local_pwd: z.string().min(1).max(200),
});
const esquemaCamera = esquemaCredenciais.extend({ nome: texto, sn: texto });

export async function cadastrarCamera(
  db: Db,
  chave: Buffer,
  arenaId: string,
  quadraId: string,
  dados: { nome: string; sn: string; authcode: string; local_user: string; local_pwd: string },
): Promise<{ id: string } | null> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return null;
  const v = esquemaCamera.safeParse(dados);
  // Mensagem fixa: nada do que foi digitado volta no erro.
  if (!v.success) throw new ErroPainel("dados da câmera inválidos");
  const { nome, sn, authcode, local_user, local_pwd } = v.data;
  const credenciais = cifrarCredenciais({ authcode, local_user, local_pwd }, chave);

  // Um só comando: só insere se a quadra é da arena e ainda não tem câmera.
  const r = await db.query<{ id: string }>(
    `insert into cameras (arena_id, quadra_id, nome, sn, credenciais)
     select q.arena_id, q.id, $3, $4, $5
       from quadras q
      where q.id = $2 and q.arena_id = $1
        and not exists (select 1 from cameras c where c.quadra_id = q.id and c.arena_id = q.arena_id)
     returning id`,
    [arenaId, quadraId, nome, sn, credenciais],
  );
  if (r.rows[0]) return { id: r.rows[0].id };

  const q = await db.query("select 1 from quadras where id = $1 and arena_id = $2", [quadraId, arenaId]);
  if (q.rows.length === 0) return null;
  throw new ErroPainel("quadra já tem câmera");
}

export async function atualizarCredenciais(
  db: Db,
  chave: Buffer,
  arenaId: string,
  cameraId: string,
  dados: { authcode: string; local_user: string; local_pwd: string },
): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(cameraId)) return false;
  const v = esquemaCredenciais.safeParse(dados);
  if (!v.success) throw new ErroPainel("dados da câmera inválidos");
  const credenciais = cifrarCredenciais(v.data, chave);
  const r = await db.query(
    "update cameras set credenciais = $3 where id = $1 and arena_id = $2 returning id",
    [cameraId, arenaId, credenciais],
  );
  return r.rows.length === 1;
}

// Liga o botão à câmera mais recente da quadra. O token só existe no retorno:
// no banco fica apenas o hash.
export async function criarBotao(
  db: Db,
  arenaId: string,
  quadraId: string,
): Promise<{ id: string; token: string } | null> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return null;
  const q = await db.query("select 1 from quadras where id = $1 and arena_id = $2", [quadraId, arenaId]);
  if (q.rows.length === 0) return null;
  const c = await db.query<{ id: string }>(
    `select id from cameras where quadra_id = $1 and arena_id = $2
      order by criado_em desc, id limit 1`,
    [quadraId, arenaId],
  );
  const cameraId = c.rows[0]?.id;
  if (!cameraId) throw new ErroPainel("cadastre a câmera antes");

  const token = novoToken();
  const r = await db.query<{ id: string }>(
    `insert into botoes (arena_id, quadra_id, camera_id, token_hash)
     values ($1, $2, $3, $4) returning id`,
    [arenaId, quadraId, cameraId, hashToken(token)],
  );
  return { id: r.rows[0].id, token };
}

export async function revogarBotao(db: Db, arenaId: string, botaoId: string): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(botaoId)) return false;
  const r = await db.query(
    `update botoes set revogado_em = now()
      where id = $1 and arena_id = $2 and revogado_em is null returning id`,
    [botaoId, arenaId],
  );
  return r.rows.length === 1;
}

// Os 50 clipes mais recentes não expirados, de qualquer status. A URL assinada
// só existe para pronto/parcial; a chave do R2 nunca sai daqui.
export async function clipesDoPainel(
  db: Db,
  r2: LeitorR2,
  arenaId: string,
  quadraId: string,
): Promise<ClipePainel[]> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return [];
  const { rows } = await db.query<{
    id: string;
    recebido_em: Date;
    status: ClipePainel["status"];
    motivo: string | null;
    duracao: number | null;
    chave_r2: string | null;
  }>(
    `select c.id, c.recebido_em, c.status, c.motivo, c.duracao, c.chave_r2
       from clipes c
       join cameras cam on cam.id = c.camera_id and cam.arena_id = c.arena_id
      where cam.quadra_id = $1
        and cam.arena_id = $2
        and c.arena_id = $2
        and c.expira_em > now()
      order by c.recebido_em desc, c.id
      limit $3`,
    [quadraId, arenaId, LIMITE_CLIPES],
  );
  return Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      recebidoEm: c.recebido_em,
      status: c.status,
      motivo: c.motivo,
      duracao: c.duracao === null ? null : Number(c.duracao),
      url:
        (c.status === "pronto" || c.status === "parcial") && c.chave_r2
          ? await r2.urlLeitura(c.chave_r2)
          : null,
    })),
  );
}

// Apaga o objeto no R2 e depois a linha. Recusa clipe em andamento (o worker
// ainda escreve nele). Erro do R2 sobe e a linha fica, para tentar de novo.
export async function apagarClipe(
  db: Db,
  r2: ApagadorR2,
  arenaId: string,
  clipeId: string,
): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(clipeId)) return false;
  const { rows } = await db.query<{ status: string; chave_r2: string | null }>(
    "select status, chave_r2 from clipes where id = $1 and arena_id = $2",
    [clipeId, arenaId],
  );
  const c = rows[0];
  if (!c || c.status === "pendente" || c.status === "processando") return false;

  // Só apaga o objeto que o worker gravaria para este clipe.
  if (c.chave_r2) {
    if (c.chave_r2 !== chaveDoClipe(arenaId, clipeId)) throw new ErroPainel("chave do clipe inconsistente");
    await r2.apagar(c.chave_r2);
    await r2.apagar(chaveDaCapa(arenaId, clipeId));
  }
  // Repete o filtro de status: se o clipe voltou a andamento no meio, não apaga.
  const d = await db.query(
    `delete from clipes
      where id = $1 and arena_id = $2 and status not in ('pendente', 'processando') returning id`,
    [clipeId, arenaId],
  );
  return d.rows.length === 1;
}

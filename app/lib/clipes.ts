import type { Db } from "./db";
import { chaveDaCapa } from "./r2";

export type ClipePublico = {
  id: string;
  recebidoEm: Date;
  duracao: number;
  parcial: boolean;
  url: string;
  capa: string; // URL assinada da .jpg; pode não existir no R2 (a página cai num fundo neutro)
  download: string; // URL assinada do .mp4 com Content-Disposition: attachment
  arquivo: string; // nome do .mp4 (lance-AAAA-MM-DD-HHhMM.mp4): o do download e o do "Compartilhar"
};

export type LeitorR2 = {
  urlLeitura(chave: string, opcoes?: { baixarComo?: string }): Promise<string>;
};

// lance-AAAA-MM-DD-HHhMM.mp4 no horário de Brasília.
function nomeDoDownload(quando: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    })
      .formatToParts(quando)
      .map((x) => [x.type, x.value]),
  );
  return `lance-${p.year}-${p.month}-${p.day}-${p.hour}h${p.minute}.mp4`;
}

export type LinhaClipe = {
  id: string;
  recebido_em: Date;
  duracao: number | null;
  status: string;
  chave_r2: string;
};

// Monta o clipe público com as três URLs assinadas (vídeo, capa e download).
export async function paraClipePublico(r2: LeitorR2, arenaId: string, c: LinhaClipe): Promise<ClipePublico> {
  const arquivo = nomeDoDownload(c.recebido_em);
  return {
    id: c.id,
    recebidoEm: c.recebido_em,
    duracao: Number(c.duracao ?? 0),
    parcial: c.status === "parcial",
    url: await r2.urlLeitura(c.chave_r2),
    capa: await r2.urlLeitura(chaveDaCapa(arenaId, c.id)),
    download: await r2.urlLeitura(c.chave_r2, { baixarComo: arquivo }),
    arquivo,
  };
}

export const SLUG_VALIDO = /^[A-Za-z0-9_-]{20,64}$/;
const LIMITE = 50;

// Lista todos os clipes prontos da quadra, pelo slug. NÃO usar em página pública:
// esta lista traz todos os clipes da quadra, e isso é só do dono. Hoje nenhuma
// página a usa; fica com os testes.
// Devolve null para slug malformado (sem tocar no banco) ou desconhecido.
// Clipes não têm quadra_id: a ligação é pela câmera, e a consulta filtra por
// quadra_id e arena_id. Não devolve motivo, chave_r2, camera_id nem campos da
// arena; só o id do clipe, que a página usa como chave de lista. Atenção: o
// arena_id aparece dentro da URL assinada (clipes/<arena_id>/<clipe_id>.mp4),
// inerente ao formato da chave; sem a assinatura não há acesso. Qualquer
// endpoint futuro que receba o id do clipe precisa revalidar quadra e arena.
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

  const clipes = await Promise.all(rows.map((c) => paraClipePublico(r2, quadra.arena_id, c)));
  return { quadra: quadra.nome, clipes };
}

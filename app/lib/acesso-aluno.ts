import type { Db } from "./db";
import { conferirSenha } from "./senha";
import { hashToken, novoToken } from "./segredos";
import { DURACAO_SESSAO_S, obterHashFalso, registrarTentativa, type ResultadoEntrar } from "./sessao";
import { SLUG_VALIDO, paraClipePublico, type ClipePublico, type LeitorR2, type LinhaClipe } from "./clipes";

// Acesso do aluno: login preso à arena da quadra do QR e as regras que decidem
// quais lances ele vê (por reserva ou por atribuição explícita do dono). A sessão
// do aluno vive em tabela própria e nunca vale como sessão de dono.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url (novoToken)

export type SessaoAluno = { alunoId: string; arenaId: string; nome: string };

type Quadra = { id: string; arena_id: string; nome: string };

// Slug malformado nunca toca o banco; desconhecido devolve null.
async function quadraDoSlug(db: Db, slug: string): Promise<Quadra | null> {
  if (typeof slug !== "string" || !SLUG_VALIDO.test(slug)) return null;
  const q = await db.query<Quadra>("select id, arena_id, nome from quadras where slug = $1", [slug]);
  return q.rows[0] ?? null;
}

export async function entrarAluno(
  db: Db,
  slug: string,
  email: string,
  senha: string,
  ip: string,
): Promise<ResultadoEntrar> {
  const emailNorm = String(email ?? "").trim().toLowerCase();

  // Limpeza oportunista: sessões vencidas e tentativas com mais de 1 dia.
  await db.query("delete from sessoes_aluno where expira_em < now()");
  await db.query("delete from tentativas_login where em < now() - interval '1 day'");

  if (await registrarTentativa(db, emailNorm, ip)) return { ok: false, motivo: "bloqueado" };

  // A arena vem da quadra do slug; o aluno é procurado só nela.
  const quadra = await quadraDoSlug(db, slug);
  const a = quadra
    ? await db.query<{ id: string; arena_id: string; senha_hash: string }>(
        "select id, arena_id, senha_hash from alunos where arena_id = $1 and email = $2",
        [quadra.arena_id, emailNorm],
      )
    : { rows: [] as { id: string; arena_id: string; senha_hash: string }[] };
  const aluno = a.rows[0];
  // Slug ou e-mail desconhecido gasta o mesmo scrypt e dá a mesma resposta.
  const certa = await conferirSenha(String(senha ?? ""), aluno ? aluno.senha_hash : await obterHashFalso());
  if (!aluno || !certa) return { ok: false, motivo: "credenciais" };

  await db.query("delete from tentativas_login where email = $1", [emailNorm]);
  const token = novoToken();
  const r = await db.query<{ expira_em: Date }>(
    `insert into sessoes_aluno (arena_id, aluno_id, token_hash, expira_em)
     values ($1, $2, $3, now() + make_interval(secs => $4)) returning expira_em`,
    [aluno.arena_id, aluno.id, hashToken(token), DURACAO_SESSAO_S],
  );
  return { ok: true, token, expiraEm: new Date(r.rows[0].expira_em) };
}

export async function validarSessaoAluno(db: Db, token: string): Promise<SessaoAluno | null> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return null;
  const r = await db.query<{ aluno_id: string; arena_id: string; nome: string }>(
    `select s.aluno_id, s.arena_id, a.nome
       from sessoes_aluno s
       join alunos a on a.id = s.aluno_id and a.arena_id = s.arena_id
      where s.token_hash = $1 and s.expira_em > now()`,
    [hashToken(token)],
  );
  const l = r.rows[0];
  return l ? { alunoId: l.aluno_id, arenaId: l.arena_id, nome: l.nome } : null;
}

export async function sairAluno(db: Db, token: string): Promise<void> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return;
  await db.query("delete from sessoes_aluno where token_hash = $1", [hashToken(token)]);
}

// Reservas da quadra que ainda estão na retenção, com pelo menos um aluno e um
// lance visível. Só o primeiro nome dos alunos; nunca e-mail nem sobrenome.
export async function reservasPublicas(
  db: Db,
  slug: string,
): Promise<{
  quadra: string;
  reservas: { id: string; inicio: Date; fim: Date; primeirosNomes: string[]; lances: number }[];
} | null> {
  const quadra = await quadraDoSlug(db, slug);
  if (!quadra) return null;
  const { rows } = await db.query<{
    id: string; inicio: Date; fim: Date; lances: number; nomes: string[] | null;
  }>(
    `select r.id, r.inicio, r.fim,
            (select count(*) from clipes c
               join cameras cam on cam.id = c.camera_id and cam.arena_id = c.arena_id
              where cam.quadra_id = r.quadra_id and cam.arena_id = r.arena_id
                and c.arena_id = r.arena_id
                and c.status in ('pronto', 'parcial') and c.chave_r2 is not null
                and c.expira_em > now()
                and c.recebido_em >= r.inicio and c.recebido_em < r.fim)::int as lances,
            (select array_agg(split_part(btrim(a.nome), ' ', 1) order by a.nome, a.id)
               from reserva_alunos ra
               join alunos a on a.id = ra.aluno_id and a.arena_id = ra.arena_id
              where ra.reserva_id = r.id and ra.arena_id = r.arena_id) as nomes
       from reservas r
       join arenas ar on ar.id = r.arena_id
      where r.quadra_id = $1 and r.arena_id = $2
        and r.fim >= now() - make_interval(days => ar.dias_retencao)
      order by r.inicio desc, r.id`,
    [quadra.id, quadra.arena_id],
  );
  return {
    quadra: quadra.nome,
    reservas: rows
      .filter((r) => Number(r.lances) > 0 && r.nomes !== null && r.nomes.length > 0)
      .map((r) => ({
        id: r.id, inicio: r.inicio, fim: r.fim, primeirosNomes: r.nomes as string[], lances: Number(r.lances),
      })),
  };
}

const COLUNAS_CLIPE = "c.id, c.recebido_em, c.duracao, c.status, c.chave_r2";

// Lances da reserva para um aluno que está nela. null se a reserva não é da
// quadra/arena do slug ou o aluno não está nela (mesma resposta nos dois casos).
export async function lancesDaReserva(
  db: Db,
  r2: LeitorR2,
  slug: string,
  reservaId: string,
  alunoId: string,
): Promise<{ reserva: { inicio: Date; fim: Date }; clipes: ClipePublico[] } | null> {
  if (!ehUuid(reservaId) || !ehUuid(alunoId)) return null;
  const quadra = await quadraDoSlug(db, slug);
  if (!quadra) return null;
  const res = await db.query<{ inicio: Date; fim: Date }>(
    `select r.inicio, r.fim
       from reservas r
       join reserva_alunos ra on ra.reserva_id = r.id and ra.arena_id = r.arena_id
      where r.id = $1 and r.quadra_id = $2 and r.arena_id = $3 and ra.aluno_id = $4`,
    [reservaId, quadra.id, quadra.arena_id, alunoId],
  );
  const reserva = res.rows[0];
  if (!reserva) return null;

  // Intervalo semiaberto: o lance exatamente em "fim" é da reserva seguinte.
  const { rows } = await db.query<LinhaClipe>(
    `select ${COLUNAS_CLIPE}
       from clipes c
       join cameras cam on cam.id = c.camera_id and cam.arena_id = c.arena_id
      where cam.quadra_id = $1 and cam.arena_id = $2 and c.arena_id = $2
        and c.status in ('pronto', 'parcial') and c.chave_r2 is not null
        and c.expira_em > now()
        and c.recebido_em >= $3 and c.recebido_em < $4
      order by c.recebido_em desc, c.id`,
    [quadra.id, quadra.arena_id, reserva.inicio, reserva.fim],
  );
  return {
    reserva: { inicio: reserva.inicio, fim: reserva.fim },
    clipes: await Promise.all(rows.map((c) => paraClipePublico(r2, quadra.arena_id, c))),
  };
}

// Lances atribuídos explicitamente ao aluno, nesta quadra.
export async function lancesAvulsosDoAluno(
  db: Db,
  r2: LeitorR2,
  slug: string,
  alunoId: string,
): Promise<ClipePublico[]> {
  if (!ehUuid(alunoId)) return [];
  const quadra = await quadraDoSlug(db, slug);
  if (!quadra) return [];
  const { rows } = await db.query<LinhaClipe>(
    `select ${COLUNAS_CLIPE}
       from clipe_alunos ca
       join clipes c on c.id = ca.clipe_id and c.arena_id = ca.arena_id
       join cameras cam on cam.id = c.camera_id and cam.arena_id = c.arena_id
      where ca.aluno_id = $3 and ca.arena_id = $2
        and cam.quadra_id = $1 and cam.arena_id = $2
        and c.status in ('pronto', 'parcial') and c.chave_r2 is not null
        and c.expira_em > now()
      order by c.recebido_em desc, c.id`,
    [quadra.id, quadra.arena_id, alunoId],
  );
  return Promise.all(rows.map((c) => paraClipePublico(r2, quadra.arena_id, c)));
}

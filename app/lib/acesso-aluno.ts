import type { Db } from "./db";
import { conferirSenha } from "./senha";
import { hashToken, novoToken } from "./segredos";
import { DURACAO_SESSAO_S, obterHashFalso, registrarTentativa, type ResultadoEntrar } from "./sessao";
import { SLUG_VALIDO, paraClipePublico, type ClipePublico, type LeitorR2, type LinhaClipe } from "./clipes";

// Acesso do aluno: login preso à arena do QR (slug da arena) e as
// regras que decidem quais lances ele vê em todas as quadras dela (por reserva ou
// por atribuição explícita do dono). A sessão do aluno vive em tabela própria e
// nunca vale como sessão de dono.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url (novoToken)

export type SessaoAluno = { alunoId: string; arenaId: string; nome: string };

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

async function abrirSessaoAluno(db: Db, arenaId: string, alunoId: string) {
  const token = novoToken();
  const r = await db.query<{ expira_em: Date }>(
    `insert into sessoes_aluno (arena_id, aluno_id, token_hash, expira_em)
     values ($1, $2, $3, now() + make_interval(secs => $4)) returning expira_em`,
    [arenaId, alunoId, hashToken(token), DURACAO_SESSAO_S],
  );
  return { token, expiraEm: new Date(r.rows[0].expira_em) };
}

export async function entrarAluno(
  db: Db,
  slugArena: string,
  email: string,
  senha: string,
  ip: string,
): Promise<ResultadoEntrar> {
  const emailNorm = String(email ?? "").trim().toLowerCase();

  // Limpeza oportunista: sessões vencidas e tentativas com mais de 1 dia.
  await db.query("delete from sessoes_aluno where expira_em < now()");
  await db.query("delete from tentativas_login where em < now() - interval '1 day'");

  // A arena vem do slug; o aluno é procurado só nela. A chave do limite é por
  // conta (arena + e-mail); slug desconhecido usa "?" no lugar da arena.
  const arena = await arenaPorSlug(db, slugArena);
  const chave = `aluno:${arena?.id ?? "?"}:${emailNorm}`;
  if (await registrarTentativa(db, chave, ip)) return { ok: false, motivo: "bloqueado" };
  const a = arena
    ? await db.query<{ id: string; arena_id: string; senha_hash: string }>(
        "select id, arena_id, senha_hash from alunos where arena_id = $1 and email = $2",
        [arena.id, emailNorm],
      )
    : { rows: [] as { id: string; arena_id: string; senha_hash: string }[] };
  const aluno = a.rows[0];
  // Slug ou e-mail desconhecido gasta o mesmo scrypt e dá a mesma resposta.
  const certa = await conferirSenha(String(senha ?? ""), aluno ? aluno.senha_hash : await obterHashFalso());
  if (!aluno || !certa) return { ok: false, motivo: "credenciais" };
  // Só quem acertou a senha fica sabendo que a arena está suspensa.
  if (arena?.status !== "ativa") return { ok: false, motivo: "suspensa" };

  await db.query("delete from tentativas_login where email = $1", [chave]);
  return { ok: true, ...(await abrirSessaoAluno(db, aluno.arena_id, aluno.id)) };
}

export async function validarSessaoAluno(db: Db, token: string): Promise<SessaoAluno | null> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return null;
  const r = await db.query<{ aluno_id: string; arena_id: string; nome: string }>(
    `select s.aluno_id, s.arena_id, a.nome
       from sessoes_aluno s
       join alunos a on a.id = s.aluno_id and a.arena_id = s.arena_id
       join arenas ar on ar.id = s.arena_id
      where s.token_hash = $1 and s.expira_em > now()
        and ar.status_assinatura = 'ativa'`,
    [hashToken(token)],
  );
  const l = r.rows[0];
  return l ? { alunoId: l.aluno_id, arenaId: l.arena_id, nome: l.nome } : null;
}

export async function sairAluno(db: Db, token: string): Promise<void> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return;
  await db.query("delete from sessoes_aluno where token_hash = $1", [hashToken(token)]);
}

// Reservas do aluno em todas as quadras da arena do slug, ainda na retenção e com
// pelo menos um lance visível, cada uma com o nome da quadra. Não há lista pública:
// nada aqui traz nome ou e-mail (nem o do próprio aluno), e aluno de outra arena nunca casa.
export async function reservasDoAluno(
  db: Db,
  slugArena: string,
  alunoId: string,
): Promise<{
  arena: string;
  arenaId: string;
  reservas: { id: string; quadra: string; inicio: Date; fim: Date; lances: number }[];
} | null> {
  const arena = await arenaPorSlug(db, slugArena);
  if (!arena) return null;
  if (!ehUuid(alunoId)) return { arena: arena.nome, arenaId: arena.id, reservas: [] };
  const { rows } = await db.query<{ id: string; quadra: string; inicio: Date; fim: Date; lances: number }>(
    `select r.id, q.nome as quadra, r.inicio, r.fim,
            (select count(*) from clipes c
               join cameras cam on cam.id = c.camera_id and cam.arena_id = c.arena_id
              where cam.quadra_id = r.quadra_id and cam.arena_id = r.arena_id
                and c.arena_id = r.arena_id
                and c.status in ('pronto', 'parcial') and c.chave_r2 is not null
                and c.expira_em > now()
                and c.recebido_em >= r.inicio and c.recebido_em < r.fim)::int as lances
       from reservas r
       join arenas ar on ar.id = r.arena_id
       join quadras q on q.id = r.quadra_id and q.arena_id = r.arena_id
       join reserva_alunos ra on ra.reserva_id = r.id and ra.arena_id = r.arena_id
      where r.arena_id = $1 and ra.aluno_id = $2
        and r.fim >= now() - make_interval(days => ar.dias_retencao)
      order by r.inicio desc, r.id`,
    [arena.id, alunoId],
  );
  return {
    arena: arena.nome,
    arenaId: arena.id,
    reservas: rows
      .filter((r) => Number(r.lances) > 0)
      .map((r) => ({ id: r.id, quadra: r.quadra, inicio: r.inicio, fim: r.fim, lances: Number(r.lances) })),
  };
}

const COLUNAS_CLIPE = "c.id, c.recebido_em, c.duracao, c.status, c.chave_r2";

// Lances da reserva para um aluno que está nela. null se a reserva não é da
// arena do slug ou o aluno não está nela (mesma resposta nos dois casos).
export async function lancesDaReserva(
  db: Db,
  r2: LeitorR2,
  slugArena: string,
  reservaId: string,
  alunoId: string,
): Promise<{ reserva: { inicio: Date; fim: Date; quadra: string }; clipes: ClipePublico[] } | null> {
  if (!ehUuid(reservaId) || !ehUuid(alunoId)) return null;
  const arena = await arenaPorSlug(db, slugArena);
  if (!arena) return null;
  const res = await db.query<{ inicio: Date; fim: Date; quadra_id: string; quadra: string }>(
    `select r.inicio, r.fim, r.quadra_id, q.nome as quadra
       from reservas r
       join quadras q on q.id = r.quadra_id and q.arena_id = r.arena_id
       join reserva_alunos ra on ra.reserva_id = r.id and ra.arena_id = r.arena_id
      where r.id = $1 and r.arena_id = $2 and ra.aluno_id = $3`,
    [reservaId, arena.id, alunoId],
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
    [reserva.quadra_id, arena.id, reserva.inicio, reserva.fim],
  );
  return {
    reserva: { inicio: reserva.inicio, fim: reserva.fim, quadra: reserva.quadra },
    clipes: await Promise.all(rows.map((c) => paraClipePublico(r2, arena.id, c))),
  };
}

// Lances atribuídos explicitamente ao aluno, em qualquer quadra da arena.
export async function lancesAvulsosDoAluno(
  db: Db,
  r2: LeitorR2,
  slugArena: string,
  alunoId: string,
): Promise<ClipePublico[]> {
  if (!ehUuid(alunoId)) return [];
  const arena = await arenaPorSlug(db, slugArena);
  if (!arena) return [];
  const { rows } = await db.query<LinhaClipe>(
    `select ${COLUNAS_CLIPE}
       from clipe_alunos ca
       join clipes c on c.id = ca.clipe_id and c.arena_id = ca.arena_id
      where ca.aluno_id = $2 and ca.arena_id = $1 and c.arena_id = $1
        and c.status in ('pronto', 'parcial') and c.chave_r2 is not null
        and c.expira_em > now()
      order by c.recebido_em desc, c.id`,
    [arena.id, alunoId],
  );
  return Promise.all(rows.map((c) => paraClipePublico(r2, arena.id, c)));
}

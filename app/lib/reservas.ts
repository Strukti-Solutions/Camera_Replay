import type { Db } from "./db";
import { ErroPainel } from "./painel";

// Reservas de quadra. Mesmas regras do painel: arena_id da sessão em toda
// consulta, uuid malformado vale como inexistente, nada de senha_hash.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

const DURACAO_MAX_MS = 12 * 60 * 60 * 1000;

export type ReservaLista = {
  id: string;
  quadraId: string;
  quadraNome: string;
  inicio: Date;
  fim: Date;
  alunos: { id: string; nome: string }[];
  lances: number;
};

const ehData = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

// Só ids de alunos que existem na arena; o resto (outra arena, malformado) é ignorado.
async function alunosValidos(db: Db, arenaId: string, alunoIds: unknown): Promise<string[]> {
  if (!Array.isArray(alunoIds)) return [];
  const candidatos = [...new Set(alunoIds.filter(ehUuid))];
  if (candidatos.length === 0) return [];
  const { rows } = await db.query<{ id: string }>(
    "select id from alunos where arena_id = $1 and id = any($2::uuid[])",
    [arenaId, candidatos],
  );
  return rows.map((r) => r.id);
}

export async function criarReserva(
  db: Db,
  arenaId: string,
  dados: { quadraId: string; inicio: Date; fim: Date; alunoIds: string[] },
): Promise<{ id: string } | null> {
  if (!ehUuid(arenaId)) return null;
  if (!ehData(dados?.inicio) || !ehData(dados?.fim)) throw new ErroPainel("horário inválido");
  const duracao = dados.fim.getTime() - dados.inicio.getTime();
  if (duracao <= 0) throw new ErroPainel("o fim precisa ser depois do início");
  if (duracao > DURACAO_MAX_MS) throw new ErroPainel("a reserva pode ter no máximo 12 horas");
  if (!ehUuid(dados.quadraId)) return null;

  const alunos = await alunosValidos(db, arenaId, dados.alunoIds);
  if (alunos.length === 0) throw new ErroPainel("escolha pelo menos um aluno");

  // Um só comando: só insere se a quadra é da arena e não há reserva
  // sobreposta (encostadas são aceitas); os vínculos entram junto.
  const r = await db.query<{ id: string }>(
    `with nova as (
       insert into reservas (arena_id, quadra_id, inicio, fim)
       select q.arena_id, q.id, $3::timestamptz, $4::timestamptz
         from quadras q
        where q.id = $2 and q.arena_id = $1
          and not exists (
            select 1 from reservas o
             where o.quadra_id = q.id and o.arena_id = q.arena_id
               and $3::timestamptz < o.fim and $4::timestamptz > o.inicio)
       returning id, arena_id
     ), v as (
       insert into reserva_alunos (reserva_id, aluno_id, arena_id)
       select nova.id, a, nova.arena_id from nova, unnest($5::uuid[]) as a
     )
     select id from nova`,
    [arenaId, dados.quadraId, dados.inicio, dados.fim, alunos],
  );
  if (r.rows[0]) return { id: r.rows[0].id };

  const q = await db.query("select 1 from quadras where id = $1 and arena_id = $2", [dados.quadraId, arenaId]);
  if (q.rows.length === 0) return null;
  throw new ErroPainel("já existe reserva nesse horário");
}

type LinhaReserva = {
  id: string;
  quadra_id: string;
  quadra_nome: string;
  inicio: Date;
  fim: Date;
  lances: number;
  alunos: { id: string; nome: string }[] | null;
};

export async function listarReservas(
  db: Db,
  arenaId: string,
  filtro: { quadraId?: string; desde?: Date } = {},
): Promise<ReservaLista[]> {
  if (!ehUuid(arenaId)) return [];
  if (filtro.quadraId !== undefined && !ehUuid(filtro.quadraId)) return [];
  if (filtro.desde !== undefined && !ehData(filtro.desde)) return [];
  const { rows } = await db.query<LinhaReserva>(
    `select r.id, r.quadra_id, q.nome as quadra_nome, r.inicio, r.fim,
            (select count(*) from clipes c
               join cameras cam on cam.id = c.camera_id and cam.arena_id = c.arena_id
              where cam.quadra_id = r.quadra_id
                and cam.arena_id = r.arena_id
                and c.arena_id = r.arena_id
                and c.status in ('pronto', 'parcial')
                and c.expira_em > now()
                and c.recebido_em >= r.inicio and c.recebido_em < r.fim)::int as lances,
            (select json_agg(json_build_object('id', a.id, 'nome', a.nome) order by a.nome, a.id)
               from reserva_alunos ra
               join alunos a on a.id = ra.aluno_id and a.arena_id = ra.arena_id
              where ra.reserva_id = r.id and ra.arena_id = r.arena_id) as alunos
       from reservas r
       join quadras q on q.id = r.quadra_id and q.arena_id = r.arena_id
      where r.arena_id = $1
        and ($2::uuid is null or r.quadra_id = $2::uuid)
        and ($3::timestamptz is null or r.fim >= $3::timestamptz)
      order by r.inicio desc, r.id`,
    [arenaId, filtro.quadraId ?? null, filtro.desde ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    quadraId: r.quadra_id,
    quadraNome: r.quadra_nome,
    inicio: r.inicio,
    fim: r.fim,
    alunos: r.alunos ?? [],
    lances: Number(r.lances),
  }));
}

// Troca a lista de alunos da reserva (pelo menos um da arena). false se a
// reserva não existe nesta arena.
export async function definirAlunosDaReserva(
  db: Db,
  arenaId: string,
  reservaId: string,
  alunoIds: string[],
): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(reservaId)) return false;
  const existe = await db.query("select 1 from reservas where id = $1 and arena_id = $2", [reservaId, arenaId]);
  if (existe.rows.length === 0) return false;
  const alunos = await alunosValidos(db, arenaId, alunoIds);
  if (alunos.length === 0) throw new ErroPainel("escolha pelo menos um aluno");

  // Um só comando: tira quem saiu e põe quem entrou (sem apagar e reinserir o mesmo par).
  const r = await db.query(
    `with r as (
       select id, arena_id from reservas where id = $1 and arena_id = $2
     ), tira as (
       delete from reserva_alunos
        where reserva_id in (select id from r) and arena_id = $2
          and not (aluno_id = any($3::uuid[]))
     ), poe as (
       insert into reserva_alunos (reserva_id, aluno_id, arena_id)
       select r.id, a, r.arena_id from r, unnest($3::uuid[]) as a
       on conflict do nothing
     )
     select id from r`,
    [reservaId, arenaId, alunos],
  );
  return r.rows.length === 1;
}

export async function removerReserva(db: Db, arenaId: string, reservaId: string): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(reservaId)) return false;
  const r = await db.query("delete from reservas where id = $1 and arena_id = $2 returning id", [reservaId, arenaId]);
  return r.rows.length === 1;
}

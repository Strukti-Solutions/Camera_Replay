import { z } from "zod";
import type { Db } from "./db";
import { ErroPainel } from "./painel";
import { hashSenha } from "./senha";

// Cadastro de alunos pelo dono. Mesmas regras do painel: o arena_id vem da
// sessão, toda consulta filtra por ele, id malformado vale como inexistente e
// nada aqui devolve senha_hash.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

const SENHA_MIN = 8;
const SENHA_MAX = 200;

// Espaços de qualquer tipo (tab, NBSP...) viram um espaço simples, para o primeiro nome ser previsível.
const esquemaNome = z.string().trim().min(1).max(80).transform((s) => s.replace(/\s+/g, " "));
const esquemaEmail = z.string().trim().toLowerCase().max(200).email();
// A senha não leva trim: espaços podem fazer parte dela.
const esquemaSenha = z.string().min(SENHA_MIN).max(SENHA_MAX);

export type AlunoLista = { id: string; nome: string; email: string; reservas: number; criadoEm: Date };

export async function criarAluno(
  db: Db,
  arenaId: string,
  dados: { nome: string; email: string; senha: string },
): Promise<{ id: string }> {
  if (!ehUuid(arenaId)) throw new ErroPainel("arena inválida");
  // Mensagens fixas: nada do que foi digitado volta no erro.
  const nome = esquemaNome.safeParse(dados?.nome);
  if (!nome.success) throw new ErroPainel("nome inválido");
  const email = esquemaEmail.safeParse(dados?.email);
  if (!email.success) throw new ErroPainel("e-mail inválido");
  const senha = esquemaSenha.safeParse(dados?.senha);
  if (!senha.success) throw new ErroPainel(`senha inválida: mínimo ${SENHA_MIN} caracteres`);

  const hash = await hashSenha(senha.data);
  try {
    const r = await db.query<{ id: string }>(
      "insert into alunos (arena_id, nome, email, senha_hash) values ($1, $2, $3, $4) returning id",
      [arenaId, nome.data, email.data, hash],
    );
    return { id: r.rows[0].id };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new ErroPainel("e-mail já cadastrado");
    throw e;
  }
}

export type PaginaAlunos = { alunos: AlunoLista[]; total: number; pagina: number; paginas: number };

const POR_PAGINA_PADRAO = 10;
const POR_PAGINA_MAX = 50;

// Lista paginada com busca por nome ou e-mail. A busca usa position(), não LIKE:
// % e _ digitados valem como texto, e o termo vai sempre parametrizado.
export async function listarAlunos(
  db: Db,
  arenaId: string,
  opcoes: { busca?: string; pagina?: number; porPagina?: number } = {},
): Promise<PaginaAlunos> {
  const vazio: PaginaAlunos = { alunos: [], total: 0, pagina: 1, paginas: 1 };
  if (!ehUuid(arenaId)) return vazio;
  // O NUL sai do termo: o Postgres recusa esse caractere e a página daria erro 500.
  const termo = typeof opcoes.busca === "string" ? opcoes.busca.replace(/\u0000/g, "").trim().slice(0, 80) : "";
  const pp = Number.isFinite(opcoes.porPagina)
    ? Math.min(POR_PAGINA_MAX, Math.max(1, Math.floor(opcoes.porPagina as number)))
    : POR_PAGINA_PADRAO;
  const filtro = `a.arena_id = $1
        and ($2 = '' or position(lower($2) in lower(a.nome)) > 0
                     or position(lower($2) in lower(a.email)) > 0)`;

  const c = await db.query<{ n: number }>(`select count(*)::int as n from alunos a where ${filtro}`, [arenaId, termo]);
  const total = Number(c.rows[0].n);
  const paginas = Math.max(1, Math.ceil(total / pp));
  const pedida = Number.isFinite(opcoes.pagina) ? Math.floor(opcoes.pagina as number) : 1;
  const pagina = Math.min(paginas, Math.max(1, pedida));
  if (total === 0) return vazio;

  const { rows } = await db.query<{ id: string; nome: string; email: string; reservas: number; criado_em: Date }>(
    `select a.id, a.nome, a.email, a.criado_em,
            (select count(*) from reserva_alunos ra
              where ra.aluno_id = a.id and ra.arena_id = a.arena_id)::int as reservas
       from alunos a
      where ${filtro}
      order by a.nome, a.id
      limit $3 offset $4`,
    [arenaId, termo, pp, (pagina - 1) * pp],
  );
  return {
    alunos: rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      email: r.email,
      reservas: Number(r.reservas),
      criadoEm: r.criado_em,
    })),
    total,
    pagina,
    paginas,
  };
}

// Todos os alunos da arena (só id e nome), para os formulários de reserva e atribuição.
export async function listarAlunosParaEscolha(db: Db, arenaId: string): Promise<{ id: string; nome: string }[]> {
  if (!ehUuid(arenaId)) return [];
  const { rows } = await db.query<{ id: string; nome: string }>(
    "select id, nome from alunos where arena_id = $1 order by nome, id",
    [arenaId],
  );
  return rows.map((r) => ({ id: r.id, nome: r.nome }));
}

// Troca a senha e derruba as sessões abertas do aluno, num só comando.
export async function redefinirSenhaAluno(
  db: Db,
  arenaId: string,
  alunoId: string,
  senha: string,
): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(alunoId)) return false;
  const v = esquemaSenha.safeParse(senha);
  if (!v.success) throw new ErroPainel(`senha inválida: mínimo ${SENHA_MIN} caracteres`);
  const hash = await hashSenha(v.data);
  const r = await db.query(
    `with a as (
       update alunos set senha_hash = $3 where id = $1 and arena_id = $2 returning id
     ), s as (
       delete from sessoes_aluno where aluno_id in (select id from a) and arena_id = $2
     )
     select id from a`,
    [alunoId, arenaId, hash],
  );
  return r.rows.length === 1;
}

// As reservas, atribuições e sessões dele saem por cascade.
export async function removerAluno(db: Db, arenaId: string, alunoId: string): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(alunoId)) return false;
  const r = await db.query("delete from alunos where id = $1 and arena_id = $2 returning id", [alunoId, arenaId]);
  return r.rows.length === 1;
}

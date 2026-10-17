import type { Db } from "./db";
import { hashSenha } from "./senha";
import { novoSlug } from "./segredos";

const SENHA_MIN = 10;

// Cria a arena (já com o slug público do QR) e o usuário dono num único comando SQL (CTE): ou entram os dois
// ou nenhum, sem depender de transação explícita no tipo Db.
export async function criarArenaComDono(
  db: Db,
  dados: { arena: string; email: string; senha: string },
): Promise<{ arenaId: string; usuarioId: string }> {
  if (dados.senha.length < SENHA_MIN) throw new Error(`senha curta: mínimo ${SENHA_MIN} caracteres`);
  const email = dados.email.trim().toLowerCase();
  const hash = await hashSenha(dados.senha);
  try {
    const r = await db.query<{ arena_id: string; usuario_id: string }>(
      `with a as (insert into arenas (nome, slug) values ($1, $4) returning id)
       insert into usuarios (arena_id, email, senha_hash, papel)
       select id, $2, $3, 'dono' from a
       returning id as usuario_id, arena_id`,
      [dados.arena, email, hash, novoSlug()],
    );
    return { arenaId: r.rows[0].arena_id, usuarioId: r.rows[0].usuario_id };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new Error("e-mail já cadastrado");
    throw e;
  }
}

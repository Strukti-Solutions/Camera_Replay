import type { Db } from "./db";
import { criarArenaComDono } from "./donos";
import { hashSenha, SENHA_MIN_ADMIN } from "./senha";

// Funções de administração da plataforma: cruzam arenas. Só app/admin/** (e os CLIs
// de db/) importam este módulo, e as páginas e actions de /admin chamam depois de
// exigirSuperAdmin() (tests/isolamento-plataforma.test.ts confere).
// A lista pública de arenas (só nome e slug) mora em arenas-publicas.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StatusArena = "ativa" | "suspensa";

export type ArenaAdmin = {
  id: string; nome: string; slug: string; status: StatusArena;
  quadras: number; donoEmail: string | null; criadoEm: Date;
};

// Todas as arenas, para o painel do super admin. Nunca devolve senha_hash.
export async function listarArenasAdmin(db: Db): Promise<ArenaAdmin[]> {
  const { rows } = await db.query<{
    id: string; nome: string; slug: string; status: StatusArena; quadras: number;
    dono_email: string | null; criado_em: Date;
  }>(
    `select a.id, a.nome, a.slug, a.status_assinatura as status, a.criado_em,
            (select count(*) from quadras q where q.arena_id = a.id)::int as quadras,
            (select min(u.email) from usuarios u where u.arena_id = a.id and u.papel = 'dono') as dono_email
       from arenas a
      order by a.criado_em desc, a.id`,
  );
  return rows.map((r) => ({
    id: r.id, nome: r.nome, slug: r.slug, status: r.status,
    quadras: Number(r.quadras), donoEmail: r.dono_email, criadoEm: r.criado_em,
  }));
}

// Arena e dono num comando só (criarArenaComDono): e-mail já usado lança
// "e-mail já cadastrado" e nada fica pela metade.
export async function criarArenaAdmin(
  db: Db,
  dados: { arena: string; email: string; senha: string },
): Promise<{ arenaId: string; usuarioId: string }> {
  return criarArenaComDono(db, dados);
}

// true se a arena existe (e agora está no estado pedido); id malformado ou status
// inválido não tocam o banco. Suspender apaga as sessões de dono da arena
// (reativar não revive sessão antiga); o resto fica e volta ao reativar.
export async function definirStatusArena(db: Db, arenaId: string, status: StatusArena): Promise<boolean> {
  if (typeof arenaId !== "string" || !UUID.test(arenaId)) return false;
  if (status !== "ativa" && status !== "suspensa") return false;
  const r = await db.query("update arenas set status_assinatura = $2 where id = $1 returning id", [arenaId, status]);
  if (r.rows.length === 0) return false;
  if (status === "suspensa") {
    await db.query("delete from sessoes where arena_id = $1", [arenaId]);
  }
  return true;
}

export async function criarSuperAdmin(db: Db, dados: { email: string; senha: string }): Promise<{ id: string }> {
  if (typeof dados.senha !== "string" || dados.senha.length < SENHA_MIN_ADMIN) {
    throw new Error(`senha curta: mínimo ${SENHA_MIN_ADMIN} caracteres`);
  }
  const email = String(dados.email ?? "").trim().toLowerCase();
  if (!email.includes("@") || email.length > 200) throw new Error("e-mail inválido");
  const hash = await hashSenha(dados.senha);
  try {
    const r = await db.query<{ id: string }>(
      "insert into super_admins (email, senha_hash) values ($1, $2) returning id",
      [email, hash],
    );
    return { id: r.rows[0].id };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new Error("e-mail já cadastrado");
    throw e;
  }
}

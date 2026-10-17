import type { Db } from "./db";

// Lista pública de arenas para a página de escolha (/). Fica fora de
// plataforma.ts de propósito: este é o único dado que cruza arenas sem sessão
// de super admin, e devolve só nome e slug (nada de dono, quadras ou contagens).

const LIMITE_PUBLICO = 50;

// Arenas ativas, por nome, até 50. A busca é por trecho do nome, sem curingas
// (% e _ valem como texto).
export async function listarArenasPublicas(db: Db, busca?: string): Promise<{ nome: string; slug: string }[]> {
  const termo = typeof busca === "string" ? busca.trim().slice(0, 80) : "";
  const { rows } = await db.query<{ nome: string; slug: string }>(
    `select nome, slug from arenas
      where status_assinatura = 'ativa'
        and ($1 = '' or position(lower($1) in lower(nome)) > 0)
      order by nome, id
      limit ${LIMITE_PUBLICO}`,
    [termo],
  );
  return rows.map((r) => ({ nome: r.nome, slug: r.slug }));
}

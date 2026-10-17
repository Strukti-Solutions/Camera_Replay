import { cookies } from "next/headers";
import { cache } from "react";
import { quadraDoSlugPublica, reservasDoAluno, validarSessaoAluno, type SessaoAluno } from "@/app/lib/acesso-aluno";
import { poolCompartilhado } from "@/app/lib/pool";
import { sessaoDaArena } from "./apresentacao";

// Cookie da sessão do aluno: separado do cookie do dono (replay_sessao).
export const COOKIE_ALUNO = "replay_aluno";

// Sessão do cookie, de qualquer arena, ou null.
export const sessaoDoCookie = cache(async (): Promise<SessaoAluno | null> => {
  const token = (await cookies()).get(COOKIE_ALUNO)?.value;
  if (!token) return null;
  return validarSessaoAluno(poolCompartilhado(), token);
});

// Quadra do slug e o aluno logado nela. Sessão de outra arena vale como "não
// logado". null se o slug não existe. Sem lista pública: só o aluno logado recebe
// reservas, e são as dele. `primeirosNomes` e `minha` ficam como ponte até a
// Tarefa 18 trocar a página (que ainda os lê).
// cache() evita repetir as consultas entre metadata e página no mesmo pedido.
export const quadraEAluno = cache(async (slug: string) => {
  const sessao = await sessaoDoCookie();
  const pool = poolCompartilhado();
  const quadra = await quadraDoSlugPublica(pool, slug);
  if (!quadra) return null;
  const aluno = sessaoDaArena(sessao, quadra.arenaId);
  const dados = aluno ? await reservasDoAluno(pool, slug, aluno.alunoId) : null;
  return {
    quadra: quadra.quadra,
    arenaId: quadra.arenaId,
    reservas: (dados?.reservas ?? []).map((r) => ({ ...r, primeirosNomes: [] as string[], minha: true })),
    aluno,
  };
});

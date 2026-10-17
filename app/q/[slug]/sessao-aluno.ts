import { cookies } from "next/headers";
import { cache } from "react";
import { quadraDoSlugPublica, slugDaArenaDaQuadra, validarSessaoAluno, type SessaoAluno } from "@/app/lib/acesso-aluno";
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
// logado". null se o slug não existe. Não traz reserva nenhuma: a página que
// precisa das reservas do aluno busca com reservasDoAluno.
// cache() evita repetir as consultas entre metadata e página no mesmo pedido.
export const quadraEAluno = cache(async (slug: string) => {
  const sessao = await sessaoDoCookie();
  const quadra = await quadraDoSlugPublica(poolCompartilhado(), slug);
  if (!quadra) return null;
  // Transitório: as consultas do aluno já são por slug da arena (a Tarefa 2 move as páginas para /a).
  const slugArena = await slugDaArenaDaQuadra(poolCompartilhado(), slug);
  if (!slugArena) return null;
  return { quadra: quadra.quadra, arenaId: quadra.arenaId, slugArena, aluno: sessaoDaArena(sessao, quadra.arenaId) };
});

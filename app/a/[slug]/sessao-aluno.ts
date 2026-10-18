import { cookies } from "next/headers";
import { cache } from "react";
import { arenaDoSlug, validarSessaoAluno, type SessaoAluno } from "@/app/lib/acesso-aluno";
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

// Arena do slug e o aluno logado nela. Sessão de outra arena vale como "não
// logado"; arena suspensa nunca tem aluno logado (validarSessaoAluno já recusa,
// e aqui fica a segunda trava). null se o slug não existe. Não traz reserva nenhuma: a página que
// precisa das reservas do aluno busca com reservasDoAluno.
// cache() evita repetir as consultas entre metadata e página no mesmo pedido.
export const arenaEAluno = cache(async (slug: string) => {
  const arena = await arenaDoSlug(poolCompartilhado(), slug);
  if (!arena) return null;
  const sessao = await sessaoDoCookie();
  return {
    arena: arena.nome,
    arenaId: arena.arenaId,
    ativa: arena.ativa,
    aluno: arena.ativa ? sessaoDaArena(sessao, arena.arenaId) : null,
  };
});

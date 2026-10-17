import { cookies } from "next/headers";
import { cache } from "react";
import { reservasPublicas, validarSessaoAluno, type SessaoAluno } from "@/app/lib/acesso-aluno";
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

// Quadra do slug (com as reservas públicas) e o aluno logado nela. Sessão de
// outra arena vale como "não logado". null se o slug não existe.
// cache() evita repetir as consultas entre metadata e página no mesmo pedido.
export const quadraEAluno = cache(async (slug: string) => {
  const sessao = await sessaoDoCookie();
  const dados = await reservasPublicas(poolCompartilhado(), slug, sessao?.alunoId);
  if (!dados) return null;
  return { ...dados, aluno: sessaoDaArena(sessao, dados.arenaId) };
});

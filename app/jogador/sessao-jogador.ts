import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { poolCompartilhado } from "@/app/lib/pool";
import { destinoEntrar } from "@/app/lib/entrar-unico";
import { validarSessaoJogador, type SessaoJogador } from "@/app/lib/jogadores";

// Cookie próprio do jogador: nunca o de dono (replay_sessao) nem o de admin.
export const COOKIE_JOGADOR = "replay_jogador";

// Sessão do cookie, ou null se não houver ou estiver vencida.
export async function sessaoJogadorAtual(): Promise<SessaoJogador | null> {
  const token = (await cookies()).get(COOKIE_JOGADOR)?.value;
  if (!token) return null;
  return validarSessaoJogador(poolCompartilhado(), token);
}

// Sem jogador → /entrar; com `voltar` (caminho interno), o login volta para ele.
export async function exigirJogador(voltar?: string): Promise<SessaoJogador> {
  const sessao = await sessaoJogadorAtual();
  if (!sessao) redirect(destinoEntrar(voltar));
  return sessao;
}

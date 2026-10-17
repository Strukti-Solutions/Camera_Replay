import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { poolCompartilhado } from "@/app/lib/pool";
import { validarSessao, type Sessao } from "@/app/lib/sessao";

export const COOKIE_SESSAO = "replay_sessao";

// Sessão do cookie, ou null se não houver ou estiver vencida.
export async function sessaoAtual(): Promise<Sessao | null> {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (!token) return null;
  return validarSessao(poolCompartilhado(), token);
}

export async function exigirSessao(): Promise<Sessao> {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  return sessao;
}

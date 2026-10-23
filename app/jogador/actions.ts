"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sairJogador } from "@/app/lib/jogadores";
import { poolCompartilhado } from "@/app/lib/pool";
import { COOKIE_JOGADOR } from "./sessao-jogador";

// "Sair" do cabeçalho e de /minhas-reservas.
export async function sairJogadorAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_JOGADOR)?.value;
  if (token) await sairJogador(poolCompartilhado(), token);
  jar.delete(COOKIE_JOGADOR);
  redirect("/");
}

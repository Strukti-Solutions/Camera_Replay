"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { encerrarOutrasSessoes } from "@/app/entrar/encerrar-sessoes";
import { ipDoCliente } from "@/app/entrar/ip";
import { criarContaComLimite } from "@/app/lib/cadastro-jogador";
import { caminhoSeguro } from "@/app/lib/entrar-unico";
import { criarSessaoJogador, DURACAO_SESSAO_JOGADOR_S } from "@/app/lib/jogadores";
import { poolCompartilhado } from "@/app/lib/pool";
import { COOKIE_JOGADOR } from "@/app/jogador/sessao-jogador";
import { MENSAGEM_MUITAS_TENTATIVAS, mensagemCriarConta } from "@/app/jogador/mensagens";

// Nome e e-mail voltam para o campo depois de um erro; a senha nunca.
export type EstadoCriarConta = { erro: string | null; nome: string; email: string };

export async function criarContaAction(_estado: EstadoCriarConta, form: FormData): Promise<EstadoCriarConta> {
  const nome = String(form.get("nome") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const senha = String(form.get("senha") ?? "");
  const aceitouTermos = form.get("termos") === "on";
  const ip = ipDoCliente(await headers());

  const db = poolCompartilhado();
  const r = await criarContaComLimite(db, { nome, email, senha, aceitouTermos }, ip);
  if (!r.ok) {
    return { nome, email, erro: r.erro === "limite" ? MENSAGEM_MUITAS_TENTATIVAS : mensagemCriarConta(r.erro) };
  }

  const { token } = await criarSessaoJogador(db, r.jogadorId);
  const jar = await cookies();
  await encerrarOutrasSessoes(jar, "jogador");
  jar.set(COOKIE_JOGADOR, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
    maxAge: DURACAO_SESSAO_JOGADOR_S,
  });
  redirect(caminhoSeguro(form.get("voltar")) ?? "/");
}

"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ipDoCliente } from "@/app/entrar/ip";
import { apagarContaComLimite, trocarSenhaComLimite } from "@/app/lib/cadastro-jogador";
import { atualizarNomeJogador } from "@/app/lib/jogadores";
import { poolCompartilhado } from "@/app/lib/pool";
import { MENSAGEM_MUITAS_TENTATIVAS, mensagemMinhaConta } from "@/app/jogador/mensagens";
import { COOKIE_JOGADOR, exigirJogador } from "@/app/jogador/sessao-jogador";

// Estado dos três formulários: `erro` e `ok` nunca vêm juntos.
export type EstadoConta = { erro: string | null; ok: string | null };

// Toda action usa só o jogador da sessão (nunca um id vindo do formulário).
export async function mudarNomeAction(_e: EstadoConta, form: FormData): Promise<EstadoConta> {
  const { jogadorId } = await exigirJogador();
  const feito = await atualizarNomeJogador(poolCompartilhado(), jogadorId, String(form.get("nome") ?? ""));
  return feito ? { erro: null, ok: "Nome atualizado." } : { erro: mensagemMinhaConta("nome"), ok: null };
}

export async function trocarSenhaAction(_e: EstadoConta, form: FormData): Promise<EstadoConta> {
  const { jogadorId } = await exigirJogador();
  const token = (await cookies()).get(COOKIE_JOGADOR)?.value ?? "";
  const ip = ipDoCliente(await headers());
  const r = await trocarSenhaComLimite(
    poolCompartilhado(), jogadorId, String(form.get("atual") ?? ""), String(form.get("nova") ?? ""), token, ip,
  );
  if (r.ok) return { erro: null, ok: "Senha alterada." };
  return { erro: r.erro === "limite" ? MENSAGEM_MUITAS_TENTATIVAS : mensagemMinhaConta(r.erro), ok: null };
}

export async function apagarContaAction(_e: EstadoConta, form: FormData): Promise<EstadoConta> {
  const { jogadorId } = await exigirJogador();
  if (form.get("entendo") !== "on") {
    return { erro: "Marque a caixa para confirmar que entende.", ok: null };
  }
  const ip = ipDoCliente(await headers());
  const r = await apagarContaComLimite(poolCompartilhado(), jogadorId, String(form.get("senha") ?? ""), ip);
  if (!r.ok) return { erro: r.erro === "limite" ? MENSAGEM_MUITAS_TENTATIVAS : "Senha incorreta.", ok: null };
  (await cookies()).delete(COOKIE_JOGADOR);
  redirect("/?ok=conta-apagada");
}

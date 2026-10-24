"use server";

import { poolCompartilhado } from "@/app/lib/pool";
import { redefinirSenha } from "@/app/lib/recuperar-senha";

// `link`: o link não serve mais (a tela troca o formulário pelo pedido de um novo).
export type EstadoRedefinir = { erro: string | null; ok: string | null; link: boolean };

const OK = "Senha alterada. Entre com a nova senha.";
const LINK = "Link inválido ou vencido. Peça um novo.";
const SENHA = "Senha curta demais. Use pelo menos 8 caracteres (contas de dono pedem 10 e de admin, 12).";
const DIFERENTES = "As duas senhas não são iguais.";

export async function redefinirAction(_estado: EstadoRedefinir, form: FormData): Promise<EstadoRedefinir> {
  const token = String(form.get("t") ?? "");
  const nova = String(form.get("nova") ?? "");
  if (nova !== String(form.get("confirmar") ?? "")) return { erro: DIFERENTES, ok: null, link: false };

  const r = await redefinirSenha(poolCompartilhado(), token, nova);
  if (r.ok) return { erro: null, ok: OK, link: false };
  if (r.erro === "link") return { erro: LINK, ok: null, link: true };
  return { erro: SENHA, ok: null, link: false };
}

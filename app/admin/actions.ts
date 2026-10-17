"use server";

import { revalidatePath } from "next/cache";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarArenaAdmin, criarSuperAdmin, definirStatusArena, type StatusArena } from "@/app/lib/plataforma";
import { ERRO_NOME_ARENA, ERRO_SENHA_LONGA, mensagemErroAdmin, nomeDaArena, senhaLongaDemais } from "./apresentacao";
import { exigirSuperAdmin } from "./sessao-admin-atual";

// Server Actions são endpoints públicos: cada uma confere a sessão de super
// admin antes de tocar em plataforma.ts (a página não protege a action).
// A senha nunca volta no estado nem vai para log.

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

const EMAIL_MAX = 200;
const emailValido = (email: string) => email.includes("@") && email.length <= EMAIL_MAX;

// Nome da arena e e-mail do dono voltam para o formulário depois de um erro.
export type EstadoNovaArena = { erro: string | null; ok: boolean; arena: string; email: string };

export async function criarArenaAction(_estado: EstadoNovaArena, form: FormData): Promise<EstadoNovaArena> {
  await exigirSuperAdmin();
  const arenaBruta = campo(form, "arena");
  const email = campo(form, "email").trim();
  const volta = (erro: string): EstadoNovaArena => ({ erro, ok: false, arena: arenaBruta, email });

  const arena = nomeDaArena(arenaBruta);
  if (!arena) return volta(ERRO_NOME_ARENA);
  if (!emailValido(email)) return volta("E-mail inválido.");
  const senha = campo(form, "senha");
  if (senhaLongaDemais(senha)) return volta(ERRO_SENHA_LONGA);
  try {
    await criarArenaAdmin(poolCompartilhado(), { arena, email, senha });
  } catch (e) {
    return volta(mensagemErroAdmin(e, "criar arena"));
  }
  revalidatePath("/admin");
  return { erro: null, ok: true, arena: "", email: "" };
}

export type EstadoStatusArena = { erro: string | null };

async function mudarStatus(form: FormData, status: StatusArena, contexto: string): Promise<EstadoStatusArena> {
  await exigirSuperAdmin();
  try {
    const ok = await definirStatusArena(poolCompartilhado(), campo(form, "arenaId"), status);
    if (!ok) return { erro: "Arena não encontrada." };
  } catch (e) {
    return { erro: mensagemErroAdmin(e, contexto) };
  }
  revalidatePath("/admin");
  return { erro: null };
}

export async function suspenderArenaAction(_estado: EstadoStatusArena, form: FormData): Promise<EstadoStatusArena> {
  return mudarStatus(form, "suspensa", "suspender arena");
}

export async function reativarArenaAction(_estado: EstadoStatusArena, form: FormData): Promise<EstadoStatusArena> {
  return mudarStatus(form, "ativa", "reativar arena");
}

export type EstadoNovoSuperAdmin = { erro: string | null; ok: boolean; email: string };

export async function criarSuperAdminAction(
  _estado: EstadoNovoSuperAdmin,
  form: FormData,
): Promise<EstadoNovoSuperAdmin> {
  await exigirSuperAdmin();
  const email = campo(form, "email").trim();
  const senha = campo(form, "senha");
  if (senhaLongaDemais(senha)) return { erro: ERRO_SENHA_LONGA, ok: false, email };
  try {
    await criarSuperAdmin(poolCompartilhado(), { email, senha });
  } catch (e) {
    return { erro: mensagemErroAdmin(e, "criar super admin"), ok: false, email };
  }
  return { erro: null, ok: true, email: "" };
}

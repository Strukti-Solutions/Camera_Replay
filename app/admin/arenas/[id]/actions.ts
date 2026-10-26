"use server";

import { revalidatePath } from "next/cache";
import { lerChave } from "@/app/lib/cripto";
import {
  atualizarCredenciais,
  cadastrarCamera,
  criarBotao,
  criarQuadra,
  renomearQuadra,
  revogarBotao,
} from "@/app/lib/painel";
import { definirCarteiraAsaas, definirTaxaArena, detalheArenaAdmin } from "@/app/lib/plataforma";
import { poolCompartilhado } from "@/app/lib/pool";
import { mensagemDoErro } from "@/app/painel/apresentacao";
import { lerTaxa } from "../../apresentacao";
import { exigirSuperAdmin } from "../../sessao-admin-atual";

// Server Actions são endpoints públicos: cada uma exige a sessão de super admin e
// confere que a arena do campo oculto existe antes de repassar o id às funções de
// app/lib/painel.ts (que ainda filtram por ele em toda consulta).
// Nada do que foi digitado nas credenciais volta no estado nem vai para log.

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

const ARENA_NAO_ENCONTRADA = "Arena não encontrada.";

// Sessão de super admin + arena existente. null se a arena não existe.
async function arenaConferida(form: FormData): Promise<string | null> {
  await exigirSuperAdmin();
  const arena = await detalheArenaAdmin(poolCompartilhado(), campo(form, "arenaId"));
  return arena ? arena.id : null;
}

function revalidar(arenaId: string) {
  revalidatePath(`/admin/arenas/${arenaId}`);
  revalidatePath("/admin");
  // O dono vê o estado das quadras e câmeras.
  revalidatePath("/painel");
  revalidatePath("/painel/quadras/[id]", "page");
}

// ---------- Taxa ----------

export type EstadoTaxa = { erro: string | null; ok: boolean; valor: string };

export async function definirTaxaAction(_estado: EstadoTaxa, form: FormData): Promise<EstadoTaxa> {
  const valor = campo(form, "taxa");
  const arenaId = await arenaConferida(form);
  if (!arenaId) return { erro: ARENA_NAO_ENCONTRADA, ok: false, valor };
  const taxa = lerTaxa(valor);
  if (taxa === null) return { erro: "Taxa inválida. Use um número, como 10 ou 7,5.", ok: false, valor };
  try {
    const ok = await definirTaxaArena(poolCompartilhado(), arenaId, taxa);
    if (!ok) return { erro: "Taxa inválida: de 0 a 30, com até 2 casas decimais.", ok: false, valor };
  } catch (e) {
    return { erro: mensagemDoErro(e, "definir taxa"), ok: false, valor };
  }
  revalidar(arenaId);
  return { erro: null, ok: true, valor };
}

// ---------- Carteira Asaas ----------

export type EstadoCarteira = { erro: string | null; ok: boolean; valor: string };

export async function definirCarteiraAction(_estado: EstadoCarteira, form: FormData): Promise<EstadoCarteira> {
  const valor = campo(form, "carteira").slice(0, 60);
  const arenaId = await arenaConferida(form);
  if (!arenaId) return { erro: ARENA_NAO_ENCONTRADA, ok: false, valor };
  try {
    const ok = await definirCarteiraAsaas(poolCompartilhado(), arenaId, valor);
    if (!ok) return { erro: "Carteira inválida: copie o walletId do Asaas do dono (ex.: 0f0e8c2a-6c4e-…).", ok: false, valor };
  } catch (e) {
    return { erro: mensagemDoErro(e, "definir carteira"), ok: false, valor };
  }
  revalidar(arenaId);
  revalidatePath("/a/[slug]", "page");
  return { erro: null, ok: true, valor: valor.trim().toLowerCase() };
}

// ---------- Quadras ----------

export type EstadoNovaQuadra = { erro: string | null; nome: string };

export async function criarQuadraAction(_estado: EstadoNovaQuadra, form: FormData): Promise<EstadoNovaQuadra> {
  const nome = campo(form, "nome");
  const arenaId = await arenaConferida(form);
  if (!arenaId) return { erro: ARENA_NAO_ENCONTRADA, nome };
  try {
    await criarQuadra(poolCompartilhado(), arenaId, nome);
  } catch (e) {
    return { erro: mensagemDoErro(e, "criar quadra"), nome };
  }
  revalidar(arenaId);
  return { erro: null, nome: "" };
}

export type EstadoRenomear = { erro: string | null; ok: boolean };

export async function renomearQuadraAction(_estado: EstadoRenomear, form: FormData): Promise<EstadoRenomear> {
  const arenaId = await arenaConferida(form);
  if (!arenaId) return { erro: ARENA_NAO_ENCONTRADA, ok: false };
  try {
    const ok = await renomearQuadra(poolCompartilhado(), arenaId, campo(form, "quadraId"), campo(form, "nome"));
    if (!ok) return { erro: "Quadra não encontrada.", ok: false };
  } catch (e) {
    return { erro: mensagemDoErro(e, "renomear quadra"), ok: false };
  }
  revalidar(arenaId);
  return { erro: null, ok: true };
}

// ---------- Câmera ----------

// Só nome e SN voltam para o formulário depois de um erro; AuthCode, usuário
// e senha local nunca.
export type EstadoCamera = { erro: string | null; nome: string; sn: string };

export async function cadastrarCameraAction(_estado: EstadoCamera, form: FormData): Promise<EstadoCamera> {
  const nome = campo(form, "nome");
  const sn = campo(form, "sn");
  const arenaId = await arenaConferida(form);
  if (!arenaId) return { erro: ARENA_NAO_ENCONTRADA, nome, sn };
  try {
    const r = await cadastrarCamera(poolCompartilhado(), lerChave(), arenaId, campo(form, "quadraId"), {
      nome,
      sn,
      authcode: campo(form, "authcode"),
      local_user: campo(form, "local_user"),
      local_pwd: campo(form, "local_pwd"),
    });
    if (!r) return { erro: "Quadra não encontrada.", nome, sn };
  } catch (e) {
    return { erro: mensagemDoErro(e, "cadastrar câmera"), nome, sn };
  }
  revalidar(arenaId);
  return { erro: null, nome: "", sn: "" };
}

export type EstadoCredenciais = { erro: string | null; ok: boolean };

export async function atualizarCredenciaisAction(
  _estado: EstadoCredenciais,
  form: FormData,
): Promise<EstadoCredenciais> {
  const arenaId = await arenaConferida(form);
  if (!arenaId) return { erro: ARENA_NAO_ENCONTRADA, ok: false };
  try {
    const ok = await atualizarCredenciais(poolCompartilhado(), lerChave(), arenaId, campo(form, "cameraId"), {
      authcode: campo(form, "authcode"),
      local_user: campo(form, "local_user"),
      local_pwd: campo(form, "local_pwd"),
    });
    if (!ok) return { erro: "Câmera não encontrada.", ok: false };
  } catch (e) {
    return { erro: mensagemDoErro(e, "atualizar credenciais"), ok: false };
  }
  revalidar(arenaId);
  return { erro: null, ok: true };
}

// ---------- Botões ----------

// O token existe só neste estado, devolvido uma vez para a tela. Não vai
// para URL, cookie, banco (lá fica o hash) nem log; recarregar a página o perde.
export type EstadoNovoBotao = { erro: string | null; token: string | null };

export async function criarBotaoAction(_estado: EstadoNovoBotao, form: FormData): Promise<EstadoNovoBotao> {
  const arenaId = await arenaConferida(form);
  if (!arenaId) return { erro: ARENA_NAO_ENCONTRADA, token: null };
  let token: string;
  try {
    const r = await criarBotao(poolCompartilhado(), arenaId, campo(form, "quadraId"));
    if (!r) return { erro: "Quadra não encontrada.", token: null };
    token = r.token;
  } catch (e) {
    return { erro: mensagemDoErro(e, "criar botão"), token: null };
  }
  revalidar(arenaId);
  return { erro: null, token };
}

export type EstadoConfirmar = { erro: string | null };

export async function revogarBotaoAction(_estado: EstadoConfirmar, form: FormData): Promise<EstadoConfirmar> {
  const arenaId = await arenaConferida(form);
  if (!arenaId) return { erro: ARENA_NAO_ENCONTRADA };
  try {
    const ok = await revogarBotao(poolCompartilhado(), arenaId, campo(form, "botaoId"));
    if (!ok) return { erro: "Botão não encontrado ou já revogado." };
  } catch (e) {
    return { erro: mensagemDoErro(e, "revogar botão") };
  }
  revalidar(arenaId);
  return { erro: null };
}

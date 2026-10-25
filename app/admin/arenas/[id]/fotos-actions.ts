"use server";

import { revalidatePath } from "next/cache";
import { apagarFoto, moverFoto, usarComoCapa } from "@/app/lib/fotos";
import { MSG_SEM_ARMAZENAMENTO, enviarFoto } from "@/app/lib/fotos-envio";
import { detalheArenaAdmin } from "@/app/lib/plataforma";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { mensagemDoErro } from "@/app/painel/apresentacao";
import type { EstadoFotos } from "@/app/painel/fotos/actions";
import { exigirSuperAdmin } from "../../sessao-admin-atual";

// Fotos de qualquer arena, pelo super admin. Mesmo formato das ações do dono
// (app/painel/fotos/actions.ts), mas a arena vem do campo oculto `arenaId`: cada
// ação exige a sessão de super admin e confere que a arena existe antes de
// repassar o id a app/lib/fotos.ts (que filtra por ele em toda consulta).

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

const quadraDoForm = (form: FormData) => campo(form, "quadraId") || null;

async function arenaDoForm(form: FormData): Promise<string | null> {
  await exigirSuperAdmin();
  const arena = await detalheArenaAdmin(poolCompartilhado(), campo(form, "arenaId"));
  return arena?.id ?? null;
}

// O caminho recarregado nunca vem do formulário.
function recarregar() {
  revalidatePath("/admin/arenas/[id]", "page");
  revalidatePath("/painel");
  revalidatePath("/painel/arena");
  revalidatePath("/painel/quadras/[id]", "page");
}

export async function enviarFotosAdminAction(estado: EstadoFotos, form: FormData): Promise<EstadoFotos> {
  const versao = estado.versao + 1;
  const arenaId = await arenaDoForm(form);
  if (!arenaId) return { erro: "Arena não encontrada.", enviadas: 0, versao };
  const config = lerConfigR2();
  if (!config) return { erro: MSG_SEM_ARMAZENAMENTO, enviadas: 0, versao };
  const arquivos = form.getAll("foto").filter((f): f is File => f instanceof File && f.size > 0);
  if (arquivos.length === 0) return { erro: "Escolha uma foto.", enviadas: 0, versao };
  const r2 = criarR2(config);
  let enviadas = 0;
  try {
    for (const arquivo of arquivos) {
      const r = await enviarFoto(poolCompartilhado(), r2, arenaId, quadraDoForm(form), new Uint8Array(await arquivo.arrayBuffer()));
      if (!r.ok) {
        if (enviadas > 0) recarregar();
        return { erro: r.erro, enviadas, versao };
      }
      enviadas++;
    }
  } catch (e) {
    if (enviadas > 0) recarregar();
    return { erro: mensagemDoErro(e, "enviar foto"), enviadas, versao };
  }
  recarregar();
  return { erro: null, enviadas, versao };
}

export async function apagarFotoAdminAction(_estado: { erro: string | null }, form: FormData): Promise<{ erro: string | null }> {
  const arenaId = await arenaDoForm(form);
  if (!arenaId) return { erro: "Arena não encontrada." };
  const config = lerConfigR2();
  // Sem R2, apagar só a linha deixaria o arquivo órfão no bucket.
  if (!config) return { erro: MSG_SEM_ARMAZENAMENTO };
  const r2 = criarR2(config);
  try {
    const ok = await apagarFoto(poolCompartilhado(), (chave) => r2.apagar(chave), arenaId, campo(form, "fotoId"));
    if (!ok) return { erro: "Foto não encontrada." };
  } catch (e) {
    return { erro: mensagemDoErro(e, "apagar foto") };
  }
  recarregar();
  return { erro: null };
}

export async function moverFotoAdminAction(form: FormData): Promise<void> {
  const arenaId = await arenaDoForm(form);
  if (!arenaId) return;
  const direcao = campo(form, "direcao") === "-1" ? -1 : campo(form, "direcao") === "1" ? 1 : null;
  if (direcao === null) return;
  if (await moverFoto(poolCompartilhado(), arenaId, campo(form, "fotoId"), direcao)) recarregar();
}

export async function capaFotoAdminAction(form: FormData): Promise<void> {
  const arenaId = await arenaDoForm(form);
  if (!arenaId) return;
  if (await usarComoCapa(poolCompartilhado(), arenaId, campo(form, "fotoId"))) recarregar();
}

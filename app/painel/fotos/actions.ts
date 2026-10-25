"use server";

import { revalidatePath } from "next/cache";
import { apagarFoto, moverFoto, usarComoCapa } from "@/app/lib/fotos";
import { MSG_SEM_ARMAZENAMENTO, enviarFoto } from "@/app/lib/fotos-envio";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { mensagemDoErro } from "@/app/painel/apresentacao";
import { exigirSessao } from "@/app/painel/sessao-atual";

// Server Actions são endpoints públicos: cada uma confere a sessão e usa só o
// arenaId dela. Ids do formulário de outra arena se comportam como inexistentes.

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

// Quadra vazia = fotos da arena.
const quadraDoForm = (form: FormData) => campo(form, "quadraId") || null;

// O caminho recarregado nunca vem do formulário.
function recarregar() {
  revalidatePath("/painel");
  revalidatePath("/painel/arena");
  revalidatePath("/painel/quadras/[id]", "page");
}

// `versao` muda a cada resposta (o formulário percebe que terminou).
export type EstadoFotos = { erro: string | null; enviadas: number; versao: number };

// Uma ou mais fotos no campo `foto`, enviadas em ordem; para no primeiro erro.
export async function enviarFotosAction(estado: EstadoFotos, form: FormData): Promise<EstadoFotos> {
  const sessao = await exigirSessao();
  const versao = estado.versao + 1;
  const config = lerConfigR2();
  if (!config) return { erro: MSG_SEM_ARMAZENAMENTO, enviadas: 0, versao };
  const arquivos = form.getAll("foto").filter((f): f is File => f instanceof File && f.size > 0);
  if (arquivos.length === 0) return { erro: "Escolha uma foto.", enviadas: 0, versao };
  const r2 = criarR2(config);
  let enviadas = 0;
  try {
    for (const arquivo of arquivos) {
      const r = await enviarFoto(
        poolCompartilhado(), r2, sessao.arenaId, quadraDoForm(form), new Uint8Array(await arquivo.arrayBuffer()),
      );
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

// Mesmo formato do formulário de confirmação (Confirmar).
export async function apagarFotoAction(_estado: { erro: string | null }, form: FormData): Promise<{ erro: string | null }> {
  const sessao = await exigirSessao();
  const config = lerConfigR2();
  // Sem R2, apagar só a linha deixaria o arquivo órfão no bucket.
  if (!config) return { erro: MSG_SEM_ARMAZENAMENTO };
  const r2 = criarR2(config);
  try {
    const ok = await apagarFoto(poolCompartilhado(), (chave) => r2.apagar(chave), sessao.arenaId, campo(form, "fotoId"));
    if (!ok) return { erro: "Foto não encontrada." };
  } catch (e) {
    return { erro: mensagemDoErro(e, "apagar foto") };
  }
  recarregar();
  return { erro: null };
}

// Mover e usar como capa: formulários simples, sem mensagem (a ordem na tela é a resposta).
export async function moverFotoAction(form: FormData): Promise<void> {
  const sessao = await exigirSessao();
  const direcao = campo(form, "direcao") === "-1" ? -1 : campo(form, "direcao") === "1" ? 1 : null;
  if (direcao === null) return;
  if (await moverFoto(poolCompartilhado(), sessao.arenaId, campo(form, "fotoId"), direcao)) recarregar();
}

export async function capaFotoAction(form: FormData): Promise<void> {
  const sessao = await exigirSessao();
  if (await usarComoCapa(poolCompartilhado(), sessao.arenaId, campo(form, "fotoId"))) recarregar();
}

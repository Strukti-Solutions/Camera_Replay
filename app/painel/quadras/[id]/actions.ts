"use server";

import { revalidatePath } from "next/cache";
import { apagarClipe } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { mensagemDoErro } from "@/app/painel/apresentacao";
import { exigirSessao } from "@/app/painel/sessao-atual";

// Server Actions são endpoints públicos: cada uma confere a sessão e usa só o
// arenaId dela. O id do clipe que vem do formulário passa por apagarClipe, que
// trata id de outra arena como inexistente.

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

// Apagar usa o formato de estado do formulário de confirmação.
export type EstadoConfirmar = { erro: string | null };

export async function apagarClipeAction(_estado: EstadoConfirmar, form: FormData): Promise<EstadoConfirmar> {
  const sessao = await exigirSessao();
  // Sem R2 não há como apagar o vídeo; apagar só a linha deixaria o arquivo
  // órfão no bucket.
  const config = lerConfigR2();
  if (!config) return { erro: "Armazenamento de vídeos não configurado. Não dá para apagar agora." };
  try {
    const ok = await apagarClipe(poolCompartilhado(), criarR2(config), sessao.arenaId, campo(form, "clipeId"));
    if (!ok) return { erro: "Clipe não encontrado ou ainda em processamento." };
  } catch (e) {
    return { erro: mensagemDoErro(e, "apagar clipe") };
  }
  // Recarrega a lista e o detalhe de quadra. O caminho não vem do formulário.
  revalidatePath("/painel");
  revalidatePath("/painel/quadras/[id]", "page");
  return { erro: null };
}

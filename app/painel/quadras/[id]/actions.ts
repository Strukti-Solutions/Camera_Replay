"use server";

import { revalidatePath } from "next/cache";
import { lerChave } from "@/app/lib/cripto";
import {
  apagarClipe,
  atribuirClipe,
  atualizarCredenciais,
  cadastrarCamera,
  criarBotao,
  revogarBotao,
} from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { mensagemDoErro } from "@/app/painel/apresentacao";
import type { EstadoAlunos } from "@/app/painel/escolha-alunos";
import { exigirSessao } from "@/app/painel/sessao-atual";

// Server Actions são endpoints públicos: cada uma confere a sessão e usa só o
// arenaId dela. Os ids que vêm do formulário passam pelas funções de
// app/lib/painel.ts, que tratam id de outra arena como inexistente.
// Nada do que foi digitado nas credenciais volta no estado nem vai para log.

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

// Recarrega a lista e qualquer detalhe de quadra. O caminho não vem do
// formulário.
function revalidar() {
  revalidatePath("/painel");
  revalidatePath("/painel/quadras/[id]", "page");
}

// ---------- Câmera ----------

// Só nome e SN voltam para o formulário depois de um erro; AuthCode, usuário
// e senha local nunca.
export type EstadoCamera = { erro: string | null; nome: string; sn: string };

export async function cadastrarCameraAction(_estado: EstadoCamera, form: FormData): Promise<EstadoCamera> {
  const sessao = await exigirSessao();
  const nome = campo(form, "nome");
  const sn = campo(form, "sn");
  try {
    const r = await cadastrarCamera(poolCompartilhado(), lerChave(), sessao.arenaId, campo(form, "quadraId"), {
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
  revalidar();
  return { erro: null, nome: "", sn: "" };
}

export type EstadoCredenciais = { erro: string | null; ok: boolean };

export async function atualizarCredenciaisAction(
  _estado: EstadoCredenciais,
  form: FormData,
): Promise<EstadoCredenciais> {
  const sessao = await exigirSessao();
  try {
    const ok = await atualizarCredenciais(poolCompartilhado(), lerChave(), sessao.arenaId, campo(form, "cameraId"), {
      authcode: campo(form, "authcode"),
      local_user: campo(form, "local_user"),
      local_pwd: campo(form, "local_pwd"),
    });
    if (!ok) return { erro: "Câmera não encontrada.", ok: false };
  } catch (e) {
    return { erro: mensagemDoErro(e, "atualizar credenciais"), ok: false };
  }
  revalidar();
  return { erro: null, ok: true };
}

// ---------- Botões ----------

// O token existe só neste estado, devolvido uma vez para a tela. Não vai
// para URL, cookie, banco (lá fica o hash) nem log; recarregar a página o perde.
export type EstadoNovoBotao = { erro: string | null; token: string | null };

export async function criarBotaoAction(_estado: EstadoNovoBotao, form: FormData): Promise<EstadoNovoBotao> {
  const sessao = await exigirSessao();
  let token: string;
  try {
    const r = await criarBotao(poolCompartilhado(), sessao.arenaId, campo(form, "quadraId"));
    if (!r) return { erro: "Quadra não encontrada.", token: null };
    token = r.token;
  } catch (e) {
    return { erro: mensagemDoErro(e, "criar botão"), token: null };
  }
  revalidar();
  return { erro: null, token };
}

// Revogar e apagar usam o mesmo formato de estado do formulário de confirmação.
export type EstadoConfirmar = { erro: string | null };

export async function revogarBotaoAction(_estado: EstadoConfirmar, form: FormData): Promise<EstadoConfirmar> {
  const sessao = await exigirSessao();
  try {
    const ok = await revogarBotao(poolCompartilhado(), sessao.arenaId, campo(form, "botaoId"));
    if (!ok) return { erro: "Botão não encontrado ou já revogado." };
  } catch (e) {
    return { erro: mensagemDoErro(e, "revogar botão") };
  }
  revalidar();
  return { erro: null };
}

// ---------- Clipes ----------

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
  revalidar();
  return { erro: null };
}

// Troca os alunos a quem o lance foi atribuído. Nenhuma caixa marcada
// retira a atribuição de todos.
export async function atribuirClipeAction(_estado: EstadoAlunos, form: FormData): Promise<EstadoAlunos> {
  const sessao = await exigirSessao();
  const alunoIds = form.getAll("alunoIds").filter((v): v is string => typeof v === "string");
  try {
    const ok = await atribuirClipe(poolCompartilhado(), sessao.arenaId, campo(form, "clipeId"), alunoIds);
    if (!ok) return { erro: "Clipe não encontrado.", ok: false };
  } catch (e) {
    return { erro: mensagemDoErro(e, "atribuir clipe"), ok: false };
  }
  revalidar();
  return { erro: null, ok: true };
}

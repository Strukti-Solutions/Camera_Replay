"use server";

import { revalidatePath } from "next/cache";
import { criarAluno, redefinirSenhaAluno, removerAluno } from "@/app/lib/alunos";
import { poolCompartilhado } from "@/app/lib/pool";
import { mensagemDoErro } from "@/app/painel/apresentacao";
import { exigirSessao } from "@/app/painel/sessao-atual";

// Server Actions são endpoints públicos: cada uma confere a sessão e usa só o
// arenaId dela. O id do aluno vem do formulário, mas app/lib/alunos.ts trata
// id de outra arena como inexistente. A senha nunca volta no estado nem vai
// para log.

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

// Alunos aparecem nas reservas e nos lances: tudo isso recarrega.
function revalidar() {
  revalidatePath("/painel/alunos");
  revalidatePath("/painel/reservas");
  revalidatePath("/painel/quadras/[id]", "page");
}

// Nome e e-mail voltam para o formulário depois de um erro; a senha nunca.
export type EstadoNovoAluno = { erro: string | null; ok: boolean; nome: string; email: string };

export async function criarAlunoAction(_estado: EstadoNovoAluno, form: FormData): Promise<EstadoNovoAluno> {
  const sessao = await exigirSessao();
  const nome = campo(form, "nome");
  const email = campo(form, "email");
  try {
    await criarAluno(poolCompartilhado(), sessao.arenaId, { nome, email, senha: campo(form, "senha") });
  } catch (e) {
    return { erro: mensagemDoErro(e, "criar aluno"), ok: false, nome, email };
  }
  revalidar();
  return { erro: null, ok: true, nome: "", email: "" };
}

export type EstadoSenhaAluno = { erro: string | null; ok: boolean };

export async function redefinirSenhaAlunoAction(_estado: EstadoSenhaAluno, form: FormData): Promise<EstadoSenhaAluno> {
  const sessao = await exigirSessao();
  try {
    const ok = await redefinirSenhaAluno(poolCompartilhado(), sessao.arenaId, campo(form, "alunoId"), campo(form, "senha"));
    if (!ok) return { erro: "Aluno não encontrado.", ok: false };
  } catch (e) {
    return { erro: mensagemDoErro(e, "redefinir senha do aluno"), ok: false };
  }
  return { erro: null, ok: true };
}

export type EstadoConfirmar = { erro: string | null };

export async function removerAlunoAction(_estado: EstadoConfirmar, form: FormData): Promise<EstadoConfirmar> {
  const sessao = await exigirSessao();
  try {
    const ok = await removerAluno(poolCompartilhado(), sessao.arenaId, campo(form, "alunoId"));
    if (!ok) return { erro: "Aluno não encontrado." };
  } catch (e) {
    return { erro: mensagemDoErro(e, "remover aluno") };
  }
  revalidar();
  return { erro: null };
}

"use server";

import { revalidatePath } from "next/cache";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarReserva, definirAlunosDaReserva, removerReserva } from "@/app/lib/reservas";
import { intervaloDaReserva, mensagemDoErro } from "@/app/painel/apresentacao";
import type { EstadoAlunos } from "@/app/painel/escolha-alunos";
import { exigirSessao } from "@/app/painel/sessao-atual";

// Server Actions são endpoints públicos: cada uma confere a sessão e usa só o
// arenaId dela. Quadra, reserva e alunos vêm do formulário, mas
// app/lib/reservas.ts trata id de outra arena como inexistente (alunos de
// outra arena são ignorados).

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

const alunoIds = (form: FormData) => form.getAll("alunoIds").filter((v): v is string => typeof v === "string");

// Reservas mudam a lista de alunos (contagem) e o rótulo dos lances.
function revalidar() {
  revalidatePath("/painel/reservas");
  revalidatePath("/painel/alunos");
  revalidatePath("/painel/quadras/[id]", "page");
}

// Tudo o que foi escolhido volta depois de um erro (o React 19 limpa o
// formulário ao fim da action). `versao` muda a cada resposta para o
// formulário remontar com esses valores (o <select> só lê o valor inicial
// na montagem).
export type EstadoNovaReserva = {
  erro: string | null;
  ok: boolean;
  versao: number;
  quadraId: string;
  data: string;
  inicio: string;
  fim: string;
  alunoIds: string[];
};

export async function criarReservaAction(estado: EstadoNovaReserva, form: FormData): Promise<EstadoNovaReserva> {
  const sessao = await exigirSessao();
  const eco = {
    versao: estado.versao + 1,
    quadraId: campo(form, "quadraId"),
    data: campo(form, "data"),
    inicio: campo(form, "inicio"),
    fim: campo(form, "fim"),
    alunoIds: alunoIds(form),
  };
  try {
    const { inicio, fim } = intervaloDaReserva(eco.data, eco.inicio, eco.fim);
    const r = await criarReserva(poolCompartilhado(), sessao.arenaId, {
      quadraId: eco.quadraId,
      inicio,
      fim,
      alunoIds: eco.alunoIds,
    });
    if (!r) return { ...eco, erro: "Quadra não encontrada.", ok: false };
  } catch (e) {
    return { ...eco, erro: mensagemDoErro(e, "criar reserva"), ok: false };
  }
  revalidar();
  // Mantém a quadra e a data: o dono costuma lançar várias reservas seguidas.
  return { ...eco, erro: null, ok: true, inicio: "", fim: "", alunoIds: [] };
}

export async function definirAlunosAction(_estado: EstadoAlunos, form: FormData): Promise<EstadoAlunos> {
  const sessao = await exigirSessao();
  try {
    const ok = await definirAlunosDaReserva(poolCompartilhado(), sessao.arenaId, campo(form, "reservaId"), alunoIds(form));
    if (!ok) return { erro: "Reserva não encontrada.", ok: false };
  } catch (e) {
    return { erro: mensagemDoErro(e, "definir alunos da reserva"), ok: false };
  }
  revalidar();
  return { erro: null, ok: true };
}

export type EstadoConfirmar = { erro: string | null };

export async function removerReservaAction(_estado: EstadoConfirmar, form: FormData): Promise<EstadoConfirmar> {
  const sessao = await exigirSessao();
  try {
    const ok = await removerReserva(poolCompartilhado(), sessao.arenaId, campo(form, "reservaId"));
    if (!ok) return { erro: "Reserva não encontrada." };
  } catch (e) {
    return { erro: mensagemDoErro(e, "remover reserva") };
  }
  revalidar();
  return { erro: null };
}

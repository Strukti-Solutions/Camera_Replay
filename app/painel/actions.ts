"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarQuadra } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { mensagemDoErro } from "./apresentacao";
import { exigirSessao } from "./sessao-atual";

// O nome volta no estado para o campo não ficar vazio depois de um erro
// (o React 19 limpa o formulário ao fim da action).
export type EstadoNovaQuadra = { erro: string | null; nome: string };

export async function criarQuadraAction(_estado: EstadoNovaQuadra, form: FormData): Promise<EstadoNovaQuadra> {
  // Arena só da sessão; a action é um endpoint público e o layout não a protege.
  const sessao = await exigirSessao();
  const nome = String(form.get("nome") ?? "");

  let id: string;
  try {
    ({ id } = await criarQuadra(poolCompartilhado(), sessao.arenaId, nome));
  } catch (e) {
    return { erro: mensagemDoErro(e, "criar quadra"), nome };
  }
  revalidatePath("/painel");
  // Fora do try: redirect() funciona lançando uma exceção.
  redirect(`/painel/quadras/${id}`);
}

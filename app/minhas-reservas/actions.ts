"use server";

import { redirect } from "next/navigation";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { poolCompartilhado } from "@/app/lib/pool";
import { cancelarPeloJogador } from "@/app/lib/reservas";

export type EstadoCancelar = { erro: string | null };

export const MSG_NAO_CANCELOU = "Não foi possível cancelar. O prazo é até 24 h antes do início.";

// Só o jogador da sessão e o relógio do servidor decidem: o formulário manda
// apenas o id da reserva.
export async function cancelarReservaAction(_estado: EstadoCancelar, form: FormData): Promise<EstadoCancelar> {
  const sessao = await exigirJogador("/minhas-reservas");
  const id = form.get("reservaId");
  let ok = false;
  try {
    ok = typeof id === "string" && (await cancelarPeloJogador(poolCompartilhado(), sessao.jogadorId, id, new Date()));
  } catch {
    return { erro: "Não foi possível cancelar agora. Tente de novo em instantes." };
  }
  if (!ok) return { erro: MSG_NAO_CANCELOU };
  redirect("/minhas-reservas?ok=cancelada");
}

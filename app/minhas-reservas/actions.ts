"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { MSG_NAO_CANCELOU } from "@/app/jogador/mensagens";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { avisarCancelamento } from "@/app/lib/avisos-email";
import { criarEnvioEmail } from "@/app/lib/email";
import { poolCompartilhado } from "@/app/lib/pool";
import { cancelarPeloJogador } from "@/app/lib/reservas";

export type EstadoCancelar = { erro: string | null };

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
  // Aviso ao dono e confirmação ao jogador, depois da resposta (não espera o Gmail).
  const reservaId = id as string;
  after(() => avisarCancelamento(poolCompartilhado(), reservaId, "jogador", criarEnvioEmail(), process.env.APP_URL?.trim() ?? ""));
  redirect("/minhas-reservas?ok=cancelada");
}

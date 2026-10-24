"use server";

import { redirect } from "next/navigation";
import { poolCompartilhado } from "@/app/lib/pool";
import { MOTIVO_CANCELAMENTO_MAX, bloquearHorario, cancelarPeloDono } from "@/app/lib/reservas";
import { exigirSessao } from "@/app/painel/sessao-atual";
import {
  MSG_BLOQUEIO_NAO_REMOVIDO,
  MSG_DONO_NAO_CANCELOU,
  MSG_MOTIVO_LONGO,
  MSG_TENTE_DE_NOVO,
} from "./apresentacao";

// Server Actions são endpoints públicos: cada uma confere a sessão e usa só o
// arenaId dela e o relógio do servidor. Id de outra arena = inexistente (a lib
// filtra pelo arenaId).

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

export type EstadoAgenda = { erro: string | null };

export async function cancelarReservaDonoAction(_e: EstadoAgenda, form: FormData): Promise<EstadoAgenda> {
  const { arenaId } = await exigirSessao();
  const motivo = campo(form, "motivo").trim();
  if (motivo.length > MOTIVO_CANCELAMENTO_MAX) return { erro: MSG_MOTIVO_LONGO };
  let ok = false;
  try {
    ok = await cancelarPeloDono(poolCompartilhado(), arenaId, campo(form, "reservaId"), motivo, new Date());
  } catch {
    return { erro: MSG_TENTE_DE_NOVO };
  }
  if (!ok) return { erro: MSG_DONO_NAO_CANCELOU };
  redirect("/painel/reservas?ok=cancelada");
}

export async function removerBloqueioAction(_e: EstadoAgenda, form: FormData): Promise<EstadoAgenda> {
  const { arenaId } = await exigirSessao();
  let ok = false;
  try {
    ok = await cancelarPeloDono(poolCompartilhado(), arenaId, campo(form, "reservaId"), undefined, new Date());
  } catch {
    return { erro: MSG_TENTE_DE_NOVO };
  }
  if (!ok) return { erro: MSG_BLOQUEIO_NAO_REMOVIDO };
  redirect("/painel/reservas?ok=removido");
}

// Os valores digitados voltam no estado para o formulário não se apagar no erro.
export type EstadoBloqueio = {
  erro: string | null;
  versao: number;
  valores: { quadraId: string; dia: string; inicio: string; fim: string; motivo: string };
};

const hora = (t: string) => (/^\d{1,2}$/.test(t) ? Number(t) : Number.NaN);

export async function bloquearHorarioAction(estado: EstadoBloqueio, form: FormData): Promise<EstadoBloqueio> {
  const { arenaId } = await exigirSessao();
  const valores = {
    quadraId: campo(form, "quadraId"),
    dia: campo(form, "dia"),
    inicio: campo(form, "inicio"),
    fim: campo(form, "fim"),
    motivo: campo(form, "motivo"),
  };
  const versao = estado.versao + 1;
  let r: Awaited<ReturnType<typeof bloquearHorario>>;
  try {
    r = await bloquearHorario(
      poolCompartilhado(),
      arenaId,
      { quadraId: valores.quadraId, dia: valores.dia, inicio: hora(valores.inicio), fim: hora(valores.fim), motivo: valores.motivo },
      new Date(),
    );
  } catch {
    return { erro: MSG_TENTE_DE_NOVO, versao, valores };
  }
  if (!r.ok) return { erro: r.erro, versao, valores };
  redirect("/painel/reservas?ok=bloqueado");
}

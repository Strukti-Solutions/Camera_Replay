"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { asaasDoAmbiente } from "@/app/lib/asaas";
import { avisarCancelamento, urlDoApp } from "@/app/lib/avisos-email";
import { criarEnvioEmail } from "@/app/lib/email";
import { estornarAposCancelar } from "@/app/lib/pagamentos";
import { poolCompartilhado } from "@/app/lib/pool";
import { MOTIVO_CANCELAMENTO_MAX, bloquearHorarios, cancelarPeloDono, removerBloqueio } from "@/app/lib/reservas";
import { exigirSessao } from "@/app/painel/sessao-atual";
import {
  MSG_BLOQUEIO_NAO_REMOVIDO,
  MSG_DONO_NAO_CANCELOU,
  MSG_MOTIVO_LONGO,
  MSG_TENTE_DE_NOVO,
  comAviso,
  voltaSegura,
} from "./apresentacao";

// Server Actions são endpoints públicos: cada uma confere a sessão e usa só o
// arenaId dela e o relógio do servidor. Id de outra arena = inexistente (a lib
// filtra pelo arenaId). Depois de agir, voltam para o mesmo dia, quadra e
// página da agenda (campo "volta", só caminhos da própria agenda).

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
  const reservaId = campo(form, "reservaId");
  // Reserva paga online: estorno integral antes de responder (falha vira "pendente").
  await estornarAposCancelar(poolCompartilhado(), asaasDoAmbiente(), reservaId)
    .catch((e) => console.error("pagamento: estorno após cancelar:", e instanceof Error ? e.message : "erro"));
  // Aviso ao jogador, depois da resposta (não espera o Gmail).
  after(() => avisarCancelamento(poolCompartilhado(), reservaId, "dono", criarEnvioEmail(), urlDoApp()));
  redirect(comAviso(voltaSegura(campo(form, "volta")), { ok: "cancelada" }));
}

export async function removerBloqueioAction(_e: EstadoAgenda, form: FormData): Promise<EstadoAgenda> {
  const { arenaId } = await exigirSessao();
  let ok = false;
  try {
    ok = await removerBloqueio(poolCompartilhado(), arenaId, campo(form, "reservaId"), new Date());
  } catch {
    return { erro: MSG_TENTE_DE_NOVO };
  }
  if (!ok) return { erro: MSG_BLOQUEIO_NAO_REMOVIDO };
  redirect(comAviso(voltaSegura(campo(form, "volta")), { ok: "desbloqueado" }));
}

// "inicio-fim" em minutos; o que não for isso vira NaN e a lib pula.
const horarioDoCampo = (v: FormDataEntryValue) => {
  const m = typeof v === "string" ? /^(\d{1,4})-(\d{1,4})$/.exec(v) : null;
  return m ? { inicio: Number(m[1]), fim: Number(m[2]) } : { inicio: Number.NaN, fim: Number.NaN };
};

// Bloqueia um horário livre ou todos os livres do dia na quadra (campo "h" repetido).
export async function bloquearAction(_e: EstadoAgenda, form: FormData): Promise<EstadoAgenda> {
  const { arenaId } = await exigirSessao();
  let r: Awaited<ReturnType<typeof bloquearHorarios>>;
  try {
    r = await bloquearHorarios(
      poolCompartilhado(),
      arenaId,
      {
        quadraId: campo(form, "quadraId"),
        dia: campo(form, "dia"),
        horarios: form.getAll("h").map(horarioDoCampo),
        motivo: campo(form, "motivo"),
      },
      new Date(),
    );
  } catch {
    return { erro: MSG_TENTE_DE_NOVO };
  }
  if (!r.ok) return { erro: r.erro };
  redirect(comAviso(voltaSegura(campo(form, "volta")), { bloqueados: String(r.bloqueados), pulados: String(r.pulados) }));
}

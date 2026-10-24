"use server";

import { redirect } from "next/navigation";
import { hrefReservar } from "@/app/a/[slug]/apresentacao";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarReserva } from "@/app/lib/reservas";

export type EstadoReservar = { erro: string | null };

const texto = (form: FormData, campo: string) => String(form.get(campo) ?? "");
// Só inteiro de 1 ou 2 dígitos; o resto vira NaN e criarReserva recusa.
const inteiro = (v: string) => (/^\d{1,2}$/.test(v) ? Number(v) : Number.NaN);

// Confirma a reserva do resumo. Tudo vem de campos escondidos, então nada aqui é
// confiável: criarReserva revalida dia, início livre e duração e recusa o que não
// cabe (nada é cortado).
export async function confirmarReservaAction(_estado: EstadoReservar, form: FormData): Promise<EstadoReservar> {
  const e = { quadra: texto(form, "quadra"), dia: texto(form, "dia"), inicio: texto(form, "inicio"), horas: texto(form, "horas") };
  const sessao = await exigirJogador(hrefReservar(e));
  const r = await criarReserva(
    poolCompartilhado(),
    sessao.jogadorId,
    { quadraId: e.quadra, dia: e.dia, inicio: inteiro(e.inicio), horas: inteiro(e.horas) },
    new Date(),
  );
  if (!r.ok) return { erro: r.erro };
  redirect("/minhas-reservas?ok=reservada");
}

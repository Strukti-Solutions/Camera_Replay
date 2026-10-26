"use server";

import { redirect } from "next/navigation";
import { hrefReservar } from "@/app/a/[slug]/apresentacao";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { criarAsaas, lerConfigAsaas } from "@/app/lib/asaas";
import { urlDoApp } from "@/app/lib/avisos-email";
import { abrirPagamento } from "@/app/lib/pagamentos";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarReserva } from "@/app/lib/reservas";

export type EstadoReservar = { erro: string | null };

const MSG_SEM_PAGAMENTO = "Não foi possível abrir o pagamento agora. O horário foi liberado; tente de novo em instantes.";

const texto = (form: FormData, campo: string) => String(form.get(campo) ?? "");
// Só inteiro de até 4 dígitos; o resto vira NaN e criarReserva recusa.
const inteiro = (v: string) => (/^(0|[1-9]\d{0,3})$/.test(v) ? Number(v) : Number.NaN);

// Confirma a reserva do resumo. Tudo vem de campos escondidos, então nada aqui é
// confiável: criarReserva revalida dia, horários livres e quantidade e recusa o que não
// cabe (nada é cortado). Arena com carteira Asaas (e o Asaas configurado): a
// reserva fica segurada e o jogador vai para o Checkout; senão, "pagar na arena".
export async function confirmarReservaAction(_estado: EstadoReservar, form: FormData): Promise<EstadoReservar> {
  const e = { quadra: texto(form, "quadra"), dia: texto(form, "dia"), inicio: texto(form, "inicio"), qtd: texto(form, "qtd") };
  const sessao = await exigirJogador(hrefReservar(e));
  const config = lerConfigAsaas();
  const r = await criarReserva(
    poolCompartilhado(),
    sessao.jogadorId,
    { quadraId: e.quadra, dia: e.dia, inicio: inteiro(e.inicio), qtd: inteiro(e.qtd) },
    new Date(),
    { online: config !== null },
  );
  if (!r.ok) return { erro: r.erro };
  if (!r.pagarOnline || !config) redirect("/minhas-reservas?ok=reservada");
  const p = await abrirPagamento(poolCompartilhado(), criarAsaas(config), sessao.jogadorId, r.reservaId, urlDoApp());
  if (!p.ok) return { erro: MSG_SEM_PAGAMENTO };
  redirect(p.link);
}

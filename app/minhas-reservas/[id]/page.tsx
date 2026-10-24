import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { poolCompartilhado } from "@/app/lib/pool";
import { lancesDaReservaDoJogador, reservasDoJogador } from "@/app/lib/reservas";
import { Galeria, leitorR2 } from "@/app/a/[slug]/galeria";
import { textoPeriodo } from "../apresentacao";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lances da reserva",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

export default async function LancesDaReserva({ params }: Props) {
  const { id } = await params;
  const sessao = await exigirJogador(`/minhas-reservas/${encodeURIComponent(id)}`);
  const db = poolCompartilhado();
  const { r2, videosDisponiveis } = leitorR2();
  const clipes = await lancesDaReservaDoJogador(db, r2, sessao.jogadorId, id);
  if (clipes === null) notFound();
  // Cabeçalho da reserva: já sabemos que é do jogador e confirmada.
  const { proximas, historico } = await reservasDoJogador(db, sessao.jogadorId, new Date());
  const reserva = [...proximas, ...historico].find((r) => r.id === id);
  if (!reserva) notFound();
  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo">
        <h1>{reserva.arena.nome} · {reserva.quadra}</h1>
        <p>{textoPeriodo(reserva.inicio, reserva.fim)}</p>
        <p className="entrar-links">
          <Link href="/minhas-reservas">Minhas reservas</Link>
        </p>
      </main>
      <Galeria clipes={clipes} videosDisponiveis={videosDisponiveis} vazio="Nenhum lance gravado nesta reserva." />
    </>
  );
}

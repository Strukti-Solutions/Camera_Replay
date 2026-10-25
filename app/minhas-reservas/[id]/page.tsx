import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LinkVoltar } from "@/app/componentes/voltar";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoDeCentavos } from "@/app/lib/precos";
import { lancesDaReservaDoJogador, reservasDoJogador } from "@/app/lib/reservas";
import { Galeria, leitorR2 } from "@/app/a/[slug]/galeria";
import { hrefReservarDeNovo, seloDaReserva, textoHorario } from "../apresentacao";
import { SeloData, SeloSituacao } from "../cartao";

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
  const agora = new Date();
  const { proximas, historico } = await reservasDoJogador(db, sessao.jogadorId, agora);
  const reserva = [...proximas, ...historico].find((r) => r.id === id);
  if (!reserva) notFound();
  const passada = reserva.fim.getTime() <= agora.getTime();
  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo-largo rv">
        <LinkVoltar href="/minhas-reservas" />
        <div className="rv-detalhe">
          <section className="rv-caixa rv-corpo" aria-labelledby="rv-titulo">
            <div className="rv-cabeca">
              <SeloData inicio={reserva.inicio} passada={passada} />
              <div>
                <h1 id="rv-titulo" className="rv-arena">
                  <Link href={`/a/${encodeURIComponent(reserva.arena.slug)}`}>{reserva.arena.nome}</Link>
                </h1>
                <p className="rv-quadra">{reserva.esporte ? `${reserva.quadra} · ${reserva.esporte}` : reserva.quadra}</p>
              </div>
            </div>
            <dl className="rv-dados">
              <div>
                <dt>Horário</dt>
                <dd>{textoHorario(reserva.inicio, reserva.fim)}</dd>
              </div>
              <div>
                <dt>Valor</dt>
                <dd>{textoDeCentavos(reserva.totalCentavos)}</dd>
              </div>
              {reserva.pagamento === "arena" && (
                <div>
                  <dt>Pagamento</dt>
                  <dd>Na arena</dd>
                </div>
              )}
              <div>
                <dt>Situação</dt>
                <dd>
                  <SeloSituacao {...seloDaReserva(reserva, agora)} />
                </dd>
              </div>
            </dl>
            <div className="rv-acoes">
              <Link className="botao" href={hrefReservarDeNovo(reserva.arena.slug, reserva.quadraId)}>
                Reservar de novo
              </Link>
            </div>
          </section>
          <section className="rv-caixa rv-lances" aria-labelledby="rv-lances-titulo">
            <h2 id="rv-lances-titulo">
              Seus lances ({clipes.length}) <small>· ficam disponíveis por até 3 dias</small>
            </h2>
            <Galeria clipes={clipes} videosDisponiveis={videosDisponiveis} vazio="Nenhum lance gravado nesta reserva." />
          </section>
        </div>
      </main>
    </>
  );
}

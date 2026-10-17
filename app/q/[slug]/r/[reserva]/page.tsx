import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { lancesDaReserva } from "@/app/lib/acesso-aluno";
import { poolCompartilhado } from "@/app/lib/pool";
import { ehUuid, tituloReserva } from "../../apresentacao";
import { Galeria, leitorR2 } from "../../galeria";
import { quadraEAluno } from "../../sessao-aluno";

// URLs assinadas valem 15 min e a lista muda a cada aperto: nada de cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reserva",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ slug: string; reserva: string }> };

export default async function PaginaDaReserva({ params }: Props) {
  const { slug, reserva } = await params;
  if (!ehUuid(reserva)) notFound();
  const dados = await quadraEAluno(slug);
  if (!dados) notFound();
  if (!dados.aluno) redirect(`/q/${slug}/entrar?r=${reserva}`);

  const { r2, videosDisponiveis } = leitorR2();
  const lances = await lancesDaReserva(poolCompartilhado(), r2, dados.slugArena, reserva, dados.aluno.alunoId);

  return (
    <>
      <header className="faixa">
        <div className="miolo">
          <div>
            <p className="faixa-quadra">{dados.quadra}</p>
            <h1>{lances ? tituloReserva(lances.reserva.inicio, lances.reserva.fim) : "Reserva"}</h1>
          </div>
          <a className="botao" href={`/q/${slug}`}>
            Voltar para as reservas
          </a>
        </div>
      </header>

      <main>
        {lances ? (
          <Galeria clipes={lances.clipes} videosDisponiveis={videosDisponiveis} vazio="Nenhum lance nesta reserva." />
        ) : (
          // Reserva de outro aluno ou inexistente: a mesma resposta.
          <div className="miolo">
            <div className="aviso">
              <p>Esta reserva não é sua.</p>
              <a className="botao" href={`/q/${slug}`}>
                Voltar para as reservas
              </a>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

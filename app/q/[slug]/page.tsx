import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { clipesDaQuadra, type LeitorR2 } from "@/app/lib/clipes";
import { formatarDuracao, formatarHorario } from "@/app/lib/formato";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { VideoClipe } from "./video-clipe";

// Lista muda a cada aperto do botão e as URLs assinadas valem 15 min:
// nada de cache estático.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// Sem R2 configurado a página ainda confere o slug e mostra o nome da
// quadra, mas não assina URL nenhuma.
const semR2: LeitorR2 = { urlLeitura: async () => "" };

// cache() evita consultar o banco duas vezes (metadata e página) no mesmo pedido.
const carregar = cache(async (slug: string) => {
  const config = lerConfigR2();
  const dados = await clipesDaQuadra(poolCompartilhado(), config ? criarR2(config) : semR2, slug);
  return dados && { ...dados, videosDisponiveis: config !== null };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const dados = await carregar(slug);
  return {
    title: dados?.quadra ?? "Quadra não encontrada",
    robots: { index: false, follow: false },
  };
}

export default async function PaginaDaQuadra({ params }: Props) {
  const { slug } = await params;
  const dados = await carregar(slug);
  if (!dados) notFound();

  const agora = new Date();

  return (
    <>
      <header className="faixa">
        <div className="miolo">
          <h1>{dados.quadra}</h1>
          {/* Link comum (não <Link>) para recarregar de verdade, inclusive sem JavaScript. */}
          <a className="botao" href={`/q/${encodeURIComponent(slug)}`}>
            Atualizar lista
          </a>
        </div>
      </header>

      <main className="miolo">
        {!dados.videosDisponiveis ? (
          <div className="aviso" role="status">
            <p>Vídeos indisponíveis no momento.</p>
          </div>
        ) : dados.clipes.length === 0 ? (
          <div className="aviso">
            <p>Nenhum lance nos últimos dias. Aperte o botão da quadra e volte em 1 minuto.</p>
          </div>
        ) : (
          <ol className="lances">
            {dados.clipes.map((clipe) => {
              const horario = formatarHorario(clipe.recebidoEm, agora);
              return (
                <li key={clipe.id} className="lance">
                  <div className="lance-cabeca">
                    <h2>{horario}</h2>
                    <p className="lance-meta">
                      <span>{formatarDuracao(clipe.duracao)}</span>
                      {clipe.parcial && <span className="selo">Parcial</span>}
                    </p>
                  </div>
                  <VideoClipe url={clipe.url} rotulo={`Lance de ${horario}`} />
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </>
  );
}

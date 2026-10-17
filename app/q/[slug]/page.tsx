import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { clipesDaQuadra, type LeitorR2 } from "@/app/lib/clipes";
import { formatarDuracao, formatarHorario } from "@/app/lib/formato";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { CarrosselLances, type LanceDoCarrossel } from "./carrossel-lances";

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

  // Horário e duração já formatados aqui: servidor e celular podem discordar
  // do relógio e do fuso ("hoje"/"ontem"), e a hidratação quebraria.
  const agora = new Date();
  const lances: LanceDoCarrossel[] = dados.clipes.map((clipe) => ({
    id: clipe.id,
    horario: formatarHorario(clipe.recebidoEm, agora),
    duracao: formatarDuracao(clipe.duracao),
    parcial: clipe.parcial,
    url: clipe.url,
    capa: clipe.capa,
    download: clipe.download,
  }));

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

      <main>
        {!dados.videosDisponiveis ? (
          <div className="miolo">
            <div className="aviso" role="status">
              <p>Vídeos indisponíveis no momento.</p>
            </div>
          </div>
        ) : lances.length === 0 ? (
          <div className="miolo">
            <div className="aviso">
              <p>Nenhum lance nos últimos dias. Aperte o botão da quadra e volte em 1 minuto.</p>
            </div>
          </div>
        ) : (
          <>
            <CarrosselLances lances={lances} />
            {/* Sem JavaScript: a lista simples, com os vídeos direto na página. */}
            <noscript>
              <div className="miolo">
                <ol className="lances">
                  {lances.map((lance) => (
                    <li key={lance.id} className="lance">
                      <div className="lance-cabeca">
                        <h2>{lance.horario}</h2>
                        <p className="lance-meta">
                          <span>{lance.duracao}</span>
                          {lance.parcial && <span className="selo">Parcial</span>}
                        </p>
                      </div>
                      <video
                        controls
                        playsInline
                        preload="none"
                        src={lance.url}
                        aria-label={`Lance de ${lance.horario}`}
                      />
                    </li>
                  ))}
                </ol>
              </div>
            </noscript>
          </>
        )}
      </main>
    </>
  );
}

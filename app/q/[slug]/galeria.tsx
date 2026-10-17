import type { ClipePublico, LeitorR2 } from "@/app/lib/clipes";
import { formatarDuracao, formatarHorario } from "@/app/lib/formato";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { CarrosselLances, type LanceDoCarrossel } from "./carrossel-lances";

// Leitor que não assina nada: sem R2 configurado, ou quando só a contagem de
// lances importa.
export const semR2: LeitorR2 = { urlLeitura: async () => "" };

export function leitorR2(): { r2: LeitorR2; videosDisponiveis: boolean } {
  const config = lerConfigR2();
  return config ? { r2: criarR2(config), videosDisponiveis: true } : { r2: semR2, videosDisponiveis: false };
}

// Carrossel dos lances (com a lista simples para quem está sem JavaScript).
export function Galeria({
  clipes,
  videosDisponiveis,
  vazio,
}: {
  clipes: ClipePublico[];
  videosDisponiveis: boolean;
  vazio: string;
}) {
  if (!videosDisponiveis) {
    return (
      <div className="miolo">
        <div className="aviso" role="status">
          <p>Vídeos indisponíveis no momento.</p>
        </div>
      </div>
    );
  }
  if (clipes.length === 0) {
    return (
      <div className="miolo">
        <div className="aviso">
          <p>{vazio}</p>
        </div>
      </div>
    );
  }

  // Horário e duração já formatados aqui: servidor e celular podem discordar
  // do relógio e do fuso ("hoje"/"ontem"), e a hidratação quebraria.
  const agora = new Date();
  const lances: LanceDoCarrossel[] = clipes.map((clipe) => ({
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
                <video controls playsInline preload="none" src={lance.url} aria-label={`Lance de ${lance.horario}`} />
              </li>
            ))}
          </ol>
        </div>
      </noscript>
    </>
  );
}

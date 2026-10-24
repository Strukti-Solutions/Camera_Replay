import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LinkVoltar } from "@/app/componentes/voltar";
import type { LeitorR2 } from "@/app/lib/clipes";
import { formatarDuracao, formatarHorario, textoStatus } from "@/app/lib/formato";
import { clipesDoPainel, detalheQuadra } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { NOMES_DIAS, textoDeCentavos, textoHora } from "@/app/lib/precos";
import { listarFaixas } from "@/app/lib/precos-quadra";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { textoCamera, textoVistoHa } from "@/app/painel/apresentacao";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { VideoClipe } from "@/app/a/[slug]/video-clipe";
import { apagarClipeAction } from "./actions";
import { Confirmar } from "./formularios";
import { FormularioFaixa, FormularioQuadra, RemoverFaixa } from "./precos";

// Segunda primeiro, domingo por último (como no formulário).
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

// URLs assinadas valem 15 min e o status da câmera muda a cada minuto.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quadra",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

// Sem R2 configurado o painel funciona, só sem player (URL vazia = sem vídeo).
const semR2: LeitorR2 = { urlLeitura: async () => "" };

export default async function PaginaQuadra({ params }: Props) {
  // A página confere a sessão por conta própria; o id da URL só vale se a
  // quadra for da arena da sessão (senão, 404 igual a id inexistente).
  const sessao = await exigirSessao();
  const { id } = await params;
  const db = poolCompartilhado();
  const quadra = await detalheQuadra(db, sessao.arenaId, id);
  if (!quadra) notFound();

  const config = lerConfigR2();
  const clipes = await clipesDoPainel(db, config ? criarR2(config) : semR2, sessao.arenaId, quadra.id);
  const faixas = await listarFaixas(db, sessao.arenaId, quadra.id);
  const porDia = ORDEM_DIAS.map((d) => ({ dia: d, faixas: faixas.filter((f) => f.diaSemana === d) })).filter(
    (g) => g.faixas.length > 0,
  );
  const agora = new Date();
  const { camera } = quadra;

  return (
    <main className="miolo painel">
      <LinkVoltar href="/painel" />
      <h1>{quadra.nome}</h1>
      <section className="secao" aria-labelledby="titulo-quadra">
        <h2 id="titulo-quadra">Quadra</h2>
        <FormularioQuadra quadraId={quadra.id} nome={quadra.nome} esporte={quadra.esporte} />
      </section>

      <section className="secao" aria-labelledby="titulo-precos">
        <h2 id="titulo-precos">Preços e horários</h2>
        {porDia.length === 0 ? (
          <p className="suave">Sem preços: esta quadra ainda não aceita reservas.</p>
        ) : (
          <ul className="faixas">
            {porDia.flatMap((g) =>
              g.faixas.map((f) => {
                const descricao = `${NOMES_DIAS[g.dia]} · ${textoHora(f.inicio)}–${textoHora(f.fim)} · ${textoDeCentavos(f.precoCentavos)}`;
                return (
                  <li key={f.id} className="faixa-preco">
                    <span>{descricao}</span>
                    <RemoverFaixa faixaId={f.id} descricao={descricao} />
                  </li>
                );
              }),
            )}
          </ul>
        )}
        <h3>Adicionar faixa</h3>
        <FormularioFaixa quadraId={quadra.id} />
      </section>

      <section className="secao" aria-labelledby="titulo-camera">
        <h2 id="titulo-camera">Câmera</h2>
        {camera ? (
          <>
            <dl className="dados">
              <div>
                <dt>Nome</dt>
                <dd>{camera.nome}</dd>
              </div>
              <div>
                <dt>SN</dt>
                <dd className="mono">{camera.sn}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`estado estado-${camera.online ? "on" : "off"}`}>{textoCamera(camera)}</span>{" "}
                  <span className="suave">{textoVistoHa(camera.vistoEm, agora)}</span>
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="suave">Sem câmera.</p>
        )}
      </section>

      <section className="secao" aria-labelledby="titulo-botoes">
        <h2 id="titulo-botoes">Botões</h2>
        {quadra.botoes.length === 0 ? (
          <p className="suave">Nenhum botão. A Strukti instala os botões da quadra.</p>
        ) : (
          <ul className="cartoes">
            {quadra.botoes.map((b) => (
              <li key={b.id} className="cartao">
                <dl className="dados">
                  <div>
                    <dt>Criado em</dt>
                    <dd>{formatarHorario(b.criadoEm, agora)}</dd>
                  </div>
                  <div>
                    <dt>Visto em</dt>
                    <dd>{b.vistoEm ? formatarHorario(b.vistoEm, agora) : "nunca"}</dd>
                  </div>
                </dl>
                {b.revogadoEm && (
                  <p>
                    <span className="selo-revogado">Revogado</span>{" "}
                    <span className="suave">{formatarHorario(b.revogadoEm, agora)}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="secao" aria-labelledby="titulo-clipes">
        <div className="secao-cabeca">
          <h2 id="titulo-clipes">Clipes</h2>
          {/* Link comum para recarregar de verdade (URLs novas, status novo). */}
          <a className="botao" href={`/painel/quadras/${quadra.id}`}>
            Atualizar lista
          </a>
        </div>
        {!config && (
          <p className="suave" role="status">
            Vídeos indisponíveis no momento.
          </p>
        )}
        {clipes.length === 0 ? (
          <p className="suave">Nenhum clipe.</p>
        ) : (
          <ol className="lances">
            {clipes.map((c) => {
              const horario = formatarHorario(c.recebidoEm, agora);
              return (
                <li key={c.id} className="lance">
                  <div className="lance-cabeca">
                    <h3>{horario}</h3>
                    <p className="lance-meta">
                      <span>{formatarDuracao(c.duracao)}</span>
                      <span className={`selo-status selo-${c.status}`}>{textoStatus(c.status)}</span>
                    </p>
                  </div>
                  {c.status === "falhou" && c.motivo && <p className="motivo">Motivo: {c.motivo}</p>}
                  {c.url && <VideoClipe url={c.url} rotulo={`Clipe de ${horario}`} />}
                  {c.status !== "pendente" && c.status !== "processando" && (
                    <Confirmar
                      acao={apagarClipeAction}
                      campo="clipeId"
                      valor={c.id}
                      rotulo="Apagar"
                      pergunta="O vídeo é apagado de vez. Não dá para desfazer."
                      confirmar="Confirmar: apagar clipe"
                    />
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}

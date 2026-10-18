import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listarAlunosParaEscolha } from "@/app/lib/alunos";
import type { LeitorR2 } from "@/app/lib/clipes";
import { formatarDuracao, formatarHorario, textoStatus } from "@/app/lib/formato";
import { clipesDoPainel, detalheQuadra } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { textoCamera, textoData, textoReserva, textoVistoHa } from "@/app/painel/apresentacao";
import { EditarAlunos } from "@/app/painel/escolha-alunos";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { VideoClipe } from "@/app/a/[slug]/video-clipe";
import { apagarClipeAction, atribuirClipeAction, revogarBotaoAction } from "./actions";
import { Confirmar, FormularioCamera, FormularioCredenciais, NovoBotao } from "./formularios";

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
  const [clipes, alunosArena] = await Promise.all([
    clipesDoPainel(db, config ? criarR2(config) : semR2, sessao.arenaId, quadra.id),
    listarAlunosParaEscolha(db, sessao.arenaId),
  ]);
  const alunos = alunosArena;
  const agora = new Date();
  const { camera } = quadra;

  return (
    <main className="miolo painel">
      <p>
        <Link href="/painel">← Quadras</Link>
      </p>
      <h1>{quadra.nome}</h1>
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
            <h3>Atualizar credenciais</h3>
            <FormularioCredenciais cameraId={camera.id} />
          </>
        ) : (
          <>
            <p className="suave">Sem câmera.</p>
            <FormularioCamera quadraId={quadra.id} />
          </>
        )}
      </section>

      <section className="secao" aria-labelledby="titulo-botoes">
        <h2 id="titulo-botoes">Botões</h2>
        {quadra.botoes.length === 0 ? (
          <p className="suave">Nenhum botão.</p>
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
                {b.revogadoEm ? (
                  <p>
                    <span className="selo-revogado">Revogado</span>{" "}
                    <span className="suave">{formatarHorario(b.revogadoEm, agora)}</span>
                  </p>
                ) : (
                  <Confirmar
                    acao={revogarBotaoAction}
                    campo="botaoId"
                    valor={b.id}
                    rotulo="Revogar"
                    pergunta="O botão para de funcionar na hora. Não dá para desfazer."
                    confirmar="Confirmar revogação"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {camera ? <NovoBotao quadraId={quadra.id} /> : <p className="suave">Cadastre a câmera antes de criar um botão.</p>}
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
                  <p className="lance-reserva">
                    {c.reserva ? (
                      <span>
                        {textoReserva(c.reserva.inicio, c.reserva.fim)}{" "}
                        <span className="suave">{textoData(c.reserva.inicio)}</span>
                      </span>
                    ) : (
                      <span className="selo-neutro">Sem reserva</span>
                    )}
                  </p>
                  {c.alunos.length > 0 && (
                    <p className="lance-alunos">
                      <span className="suave">Atribuído a:</span> {c.alunos.map((a) => a.nome).join(", ")}
                    </p>
                  )}
                  {c.status === "falhou" && c.motivo && <p className="motivo">Motivo: {c.motivo}</p>}
                  {c.url && <VideoClipe url={c.url} rotulo={`Clipe de ${horario}`} />}
                  {/* Só lance que o aluno consegue assistir vale ser atribuído. */}
                  {(c.status === "pronto" || c.status === "parcial") && alunos.length > 0 && (
                    <EditarAlunos
                      acao={atribuirClipeAction}
                      campo="clipeId"
                      valor={c.id}
                      alunos={alunos}
                      marcados={c.alunos.map((a) => a.id)}
                      rotulo="Atribuir a alunos"
                      legenda="Alunos que veem este lance"
                      salvar="Salvar atribuição"
                      salvo="Atribuição salva."
                    />
                  )}
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

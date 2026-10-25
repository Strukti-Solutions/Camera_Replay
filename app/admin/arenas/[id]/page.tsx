import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LinkVoltar } from "@/app/componentes/voltar";
import { formatarHorario } from "@/app/lib/formato";
import { FOTOS_MAX_ARENA, FOTOS_MAX_QUADRA, listarFotos } from "@/app/lib/fotos";
import { detalheQuadra, listarQuadras } from "@/app/lib/painel";
import { detalheArenaAdmin } from "@/app/lib/plataforma";
import { poolCompartilhado } from "@/app/lib/pool";
import { lerConfigR2 } from "@/app/lib/r2";
import { textoCamera, textoVistoHa } from "@/app/painel/apresentacao";
import { FotosDoDono, type AcoesFotos } from "@/app/painel/fotos/fotos";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { textoStatusArena, textoTaxa } from "../../apresentacao";
import { CabecalhoAdmin } from "../../cabecalho";
import { exigirSuperAdmin } from "../../sessao-admin-atual";
import { revogarBotaoAction } from "./actions";
import { apagarFotoAdminAction, capaFotoAdminAction, enviarFotosAdminAction, moverFotoAdminAction } from "./fotos-actions";
import {
  FormularioCamera,
  FormularioCredenciais,
  FormularioNovaQuadra,
  FormularioRenomear,
  FormularioTaxa,
  NovoBotao,
} from "./formularios";

export const dynamic = "force-dynamic";

const ACOES_FOTOS: AcoesFotos = {
  enviar: enviarFotosAdminAction, apagar: apagarFotoAdminAction, mover: moverFotoAdminAction, capa: capaFotoAdminAction,
};

export const metadata: Metadata = {
  title: "Arena",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

export default async function PaginaArenaAdmin({ params }: Props) {
  // Sessão de super admin antes de qualquer consulta; arena inexistente é 404.
  await exigirSuperAdmin();
  const { id } = await params;
  const db = poolCompartilhado();
  const arena = await detalheArenaAdmin(db, id);
  if (!arena) notFound();

  const resumos = await listarQuadras(db, arena.id);
  const detalhes = (await Promise.all(resumos.map((q) => detalheQuadra(db, arena.id, q.id)))).flatMap((d) =>
    d ? [d] : [],
  );
  const [fotosArena, fotosQuadras] = await Promise.all([
    listarFotos(db, arena.id, null),
    Promise.all(detalhes.map((q) => listarFotos(db, arena.id, q.id))),
  ]);
  const armazenamento = lerConfigR2() !== null;
  const admin = { acoes: ACOES_FOTOS, arenaId: arena.id };
  const agora = new Date();

  return (
    <>
      <CabecalhoAdmin />
      <main className="miolo painel">
        <LinkVoltar href="/admin" />
        <h1>{arena.nome}</h1>
        <dl className="dados">
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`estado estado-${arena.status === "ativa" ? "on" : "off"}`}>
                {textoStatusArena(arena.status)}
              </span>
            </dd>
          </div>
          <div>
            <dt>E-mail do dono</dt>
            <dd>{arena.donoEmail ?? "Sem dono"}</dd>
          </div>
          <div>
            <dt>Slug</dt>
            <dd className="mono">{arena.slug}</dd>
          </div>
          <div>
            <dt>Taxa</dt>
            <dd>{textoTaxa(arena.taxaPercentual)}</dd>
          </div>
        </dl>

        <section className="secao">
          <FormularioTaxa arenaId={arena.id} taxa={String(arena.taxaPercentual).replace(".", ",")} />
        </section>

        <section className="secao" aria-labelledby="fotos-arena">
          <h2 id="fotos-arena">Fotos da arena</h2>
          <FotosDoDono
            quadraId={null}
            fotos={fotosArena}
            max={FOTOS_MAX_ARENA}
            armazenamento={armazenamento}
            rotulo="da arena"
            admin={admin}
          />
        </section>

        <h2>Quadras</h2>
        {detalhes.length === 0 && <p className="painel-vazio">Nenhuma quadra cadastrada.</p>}
        {detalhes.map((quadra, iq) => {
          const { camera } = quadra;
          return (
            <section key={quadra.id} className="secao" aria-labelledby={`quadra-${quadra.id}`}>
              <h3 id={`quadra-${quadra.id}`}>{quadra.nome}</h3>
              <FormularioRenomear arenaId={arena.id} quadraId={quadra.id} nome={quadra.nome} />

              <h4>Fotos</h4>
              <FotosDoDono
                quadraId={quadra.id}
                fotos={fotosQuadras[iq]}
                max={FOTOS_MAX_QUADRA}
                armazenamento={armazenamento}
                rotulo={`da ${quadra.nome}`}
                admin={admin}
              />

              <h4>Câmera</h4>
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
                  <details>
                    <summary className="botao">Trocar credenciais</summary>
                    <FormularioCredenciais arenaId={arena.id} cameraId={camera.id} />
                  </details>
                </>
              ) : (
                <>
                  <p className="suave">Sem câmera.</p>
                  <FormularioCamera arenaId={arena.id} quadraId={quadra.id} />
                </>
              )}

              <h4>Botões</h4>
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
                          extras={{ arenaId: arena.id }}
                          rotulo="Revogar"
                          pergunta="O botão para de funcionar na hora. Não dá para desfazer."
                          confirmar="Confirmar revogação"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {camera ? (
                <NovoBotao arenaId={arena.id} quadraId={quadra.id} />
              ) : (
                <p className="suave">Cadastre a câmera antes de criar um botão.</p>
              )}
            </section>
          );
        })}

        <section className="secao">
          <FormularioNovaQuadra arenaId={arena.id} />
        </section>
      </main>
    </>
  );
}

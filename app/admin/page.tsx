import type { Metadata } from "next";
import Link from "next/link";
import { listarArenasAdmin, pendenciasDePagamento } from "@/app/lib/plataforma";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoDeCentavos } from "@/app/lib/precos";
import { reservasFuturasPorArena } from "@/app/lib/reservas";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { textoData } from "@/app/painel/apresentacao";
import { marcarEstornoResolvidoAction, reativarArenaAction, suspenderArenaAction } from "./actions";
import { textoMensalidade, textoReservasFuturas, textoStatusArena, textoTaxa, textoVencimento } from "./apresentacao";
import { CabecalhoAdmin } from "./cabecalho";
import { ConfirmarStatus, FormularioNovaArena, FormularioNovoSuperAdmin } from "./formularios";
import { exigirSuperAdmin } from "./sessao-admin-atual";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administração",
  robots: { index: false, follow: false },
};

export default async function PaginaAdmin() {
  // Sessão de super admin antes de qualquer consulta que cruza arenas.
  await exigirSuperAdmin();
  const db = poolCompartilhado();
  const [arenas, futuras, pendencias] = await Promise.all([
    listarArenasAdmin(db), reservasFuturasPorArena(db, new Date()), pendenciasDePagamento(db),
  ]);

  return (
    <>
      <CabecalhoAdmin />
      <main className="miolo painel">
        <h1>Arenas</h1>

        {arenas.length === 0 ? (
          <p className="painel-vazio">Nenhuma arena cadastrada.</p>
        ) : (
          // Rolagem horizontal no invólucro: no celular a tabela é mais larga que a tela.
          <div className="tabela-rolagem">
            <table className="tabela">
              <caption className="so-leitor">Todas as arenas</caption>
              <thead>
                <tr>
                  <th scope="col">Arena</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Quadras
                  </th>
                  <th scope="col" className="num">
                    Taxa
                  </th>
                  <th scope="col">Mensalidade</th>
                  <th scope="col">E-mail do dono</th>
                  <th scope="col">Criada em</th>
                  <th scope="col">
                    <span className="so-leitor">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {arenas.map((a) => (
                  <tr key={a.id}>
                    <td>{a.nome}</td>
                    <td>
                      <span className={`estado estado-${a.status === "ativa" ? "on" : "off"}`}>
                        {textoStatusArena(a.status)}
                      </span>
                    </td>
                    <td className="num">{a.quadras}</td>
                    <td className="num">{textoTaxa(a.taxaPercentual)}</td>
                    <td className={a.situacaoMensalidade === "atrasada" ? "texto-alerta" : "suave"}>
                      {textoMensalidade(a.mensalidadeCentavos, a.situacaoMensalidade)}
                    </td>
                    <td className="suave">{a.donoEmail ?? "Sem dono"}</td>
                    <td className="suave num-tab">{textoData(a.criadoEm)}</td>
                    <td>
                      <Link className="botao" href={`/admin/arenas/${a.id}`}>
                        Configurar
                      </Link>
                      {/* key com o status: depois de suspender ou reativar, a confirmação
                          remonta fechada; senão o <details> aberto deixaria desfazer com um clique. */}
                      {a.status === "ativa" ? (
                        <ConfirmarStatus
                          key={`${a.id}-ativa`}
                          acao={suspenderArenaAction}
                          arenaId={a.id}
                          rotulo="Suspender"
                          pergunta={`${textoReservasFuturas(futuras.get(a.id) ?? 0)} O dono perde o acesso e o botão para de gravar. Nada é apagado além do que já expiraria pela retenção de 3 dias.`}
                          confirmar="Confirmar: suspender arena"
                          perigo
                        />
                      ) : (
                        <ConfirmarStatus
                          key={`${a.id}-suspensa`}
                          acao={reativarArenaAction}
                          arenaId={a.id}
                          rotulo="Reativar"
                          pergunta="O dono volta a entrar e o botão volta a gravar."
                          confirmar="Confirmar: reativar arena"
                          perigo={false}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(pendencias.estornos.length > 0 || pendencias.eventos.length > 0 || pendencias.mensalidades.length > 0) && (
          <section className="secao" aria-labelledby="titulo-pendencias">
            <h2 id="titulo-pendencias">Pagamentos para resolver</h2>
            {pendencias.estornos.length > 0 && (
              <>
                <p className="suave">
                  Estornos que não saíram (por exemplo, dono sem saldo ou falha no meio). Confira no painel do Asaas se a
                  cobrança já foi estornada antes de estornar de novo; resolva com o dono e marque como resolvido.
                </p>
                <ul className="lista-simples">
                  {pendencias.estornos.map((e) => (
                    <li key={e.reservaId}>
                      <strong>{e.arena}</strong> · {e.jogador} · reserva de {textoData(e.inicio)} ·{" "}
                      {textoDeCentavos(e.pagoCentavos)} pago · cancelada {e.canceladaPor === "dono" ? "pela arena" : "pelo jogador"} ·{" "}
                      <span className="mono">{e.pagamentoId}</span>
                      <Confirmar
                        acao={marcarEstornoResolvidoAction}
                        campo="reservaId"
                        valor={e.reservaId}
                        rotulo="Marcar resolvido"
                        pergunta="O estorno foi feito fora do sistema? A reserva deixa de aparecer aqui."
                        confirmar="Marcar resolvido"
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {pendencias.mensalidades.length > 0 && (
              <>
                <p className="suave">Mensalidades atrasadas. Nada é suspenso sozinho: decida se suspende a arena.</p>
                <ul className="lista-simples">
                  {pendencias.mensalidades.map((m) => (
                    <li key={`${m.arenaId}-${m.vencimento}`}>
                      <Link href={`/admin/arenas/${m.arenaId}`}>
                        <strong>{m.arena}</strong>
                      </Link>{" "}
                      · venceu {textoVencimento(m.vencimento)} · {textoDeCentavos(m.valorCentavos)}
                      {m.link && (
                        <>
                          {" · "}
                          <a href={m.link} target="_blank" rel="noopener noreferrer">
                            Ver fatura
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {pendencias.eventos.length > 0 && (
              <>
                <p className="suave">Avisos do Asaas que não foram processados (os 50 mais recentes).</p>
                <ul className="lista-simples">
                  {pendencias.eventos.map((v) => (
                    <li key={v.id}>
                      {textoData(v.recebidoEm)} · {v.tipo} · {v.erro} · <span className="mono">{v.id}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        <section className="secao">
          <FormularioNovaArena />
        </section>

        <section className="secao">
          <FormularioNovoSuperAdmin />
        </section>
      </main>
    </>
  );
}

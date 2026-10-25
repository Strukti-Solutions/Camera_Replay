import type { Metadata } from "next";
import { diaPorExtenso, nomeDoMes } from "@/app/a/[slug]/apresentacao";
import { hojeLocal, partesDoInstante } from "@/app/lib/disponibilidade";
import { textoMinutos } from "@/app/lib/horarios";
import { listarHorarios } from "@/app/lib/horarios-quadra";
import { listarQuadras } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoDeCentavos } from "@/app/lib/precos";
import { BUSCA_POR_PAGINA, agendaDaArena, buscarNaAgenda, resumoDoMes, type ItemAgenda } from "@/app/lib/reservas";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { removerBloqueioAction } from "./actions";
import {
  calendarioDoDono, caixinhasDoDia, hrefAgenda, lerDiaDono, lerMesDono, lerPagina, linhaItem, mensagemDoBloqueio,
  mensagemOkAgenda, mesesDoDono, paginarCaixinhas, podeAgir, quadraDoFiltro, rotuloQuadra, semanaDoDia, type Caixinha,
} from "./apresentacao";
import { Bloquear, CancelarReservaDono } from "./formularios";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reservas",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIA_CURTO = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" });
const intervalo = (inicio: number, fim: number) => `${textoMinutos(inicio)}–${textoMinutos(fim)}`;
const intervaloDoItem = (i: ItemAgenda) =>
  intervalo(partesDoInstante(i.inicio).minuto, partesDoInstante(i.fim).minuto || 1440);
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const reais = (n: number) => textoDeCentavos(n).replace(/,00$/, "");

function situacao(i: ItemAgenda): string {
  if (i.situacao !== "cancelada") return i.tipo === "bloqueio" ? "Bloqueado" : "Confirmada";
  if (i.tipo === "bloqueio") return "Bloqueio removido";
  const quem = i.canceladaPor === "jogador" ? "Cancelada pelo jogador" : "Cancelada pela arena";
  return i.motivoCancelamento ? `${quem} · ${i.motivoCancelamento}` : quem;
}

// Uma caixinha do dia: reserva, bloqueio ou horário livre, com a ação dela.
function CaixinhaDoDia({ c, quadraId, dia, volta }: { c: Caixinha; quadraId: string; dia: string; volta: string }) {
  const horario = intervalo(c.inicio, c.fim);
  if (c.tipo === "livre") {
    return (
      <li className="ag-cx ag-cx-livre">
        <strong>{horario}</strong>
        <span className="suave">Livre · {textoDeCentavos(c.precoCentavos)}</span>
        <Bloquear quadraId={quadraId} dia={dia} horarios={[{ inicio: c.inicio, fim: c.fim }]} rotulo="Bloquear" descricao={horario} volta={volta} />
      </li>
    );
  }
  const i = c.item;
  const cancelada = i.situacao === "cancelada";
  const classe = `ag-cx ${c.tipo === "bloqueio" ? "ag-cx-bloqueio" : "ag-cx-reserva"}${cancelada ? " ag-cx-cancelada" : ""}`;
  return (
    <li className={classe}>
      <strong>{horario}</strong>
      {c.tipo === "reserva" ? (
        <>
          <span className="ag-cx-nome">{i.jogador ?? "Conta apagada"}</span>
          <span className="suave">{textoDeCentavos(i.totalCentavos ?? 0)} · pagar na arena</span>
        </>
      ) : (
        <span className="ag-cx-nome">{i.motivo || "Bloqueado"}</span>
      )}
      <span className={cancelada ? "ag-selo ag-selo-off" : "ag-selo"}>{situacao(i)}</span>
      {podeAgir(i) && c.tipo === "reserva" && <CancelarReservaDono reservaId={i.id} descricao={linhaItem(i)} volta={volta} />}
      {podeAgir(i) && c.tipo === "bloqueio" && (
        <Confirmar
          acao={removerBloqueioAction}
          campo="reservaId"
          valor={i.id}
          extras={{ volta }}
          rotulo="Desbloquear"
          rotuloAcessivel={`Desbloquear ${horario}`}
          pergunta={`Desbloquear ${linhaItem(i)}? O horário volta a ficar livre.`}
          confirmar="Desbloquear"
        />
      )}
    </li>
  );
}

function Paginas({ pagina, paginas, href }: { pagina: number; paginas: number; href: (p: number) => string }) {
  if (paginas <= 1) return null;
  return (
    <nav className="ag-paginas" aria-label="Páginas">
      {pagina > 1 ? <a href={href(pagina - 1)}>‹ Anterior</a> : <span />}
      <span>
        Página {pagina} de {paginas}
      </span>
      {pagina < paginas ? <a href={href(pagina + 1)}>Próxima ›</a> : <span />}
    </nav>
  );
}

export default async function PaginaReservas({ searchParams }: Props) {
  // Tudo sai do arenaId da sessão; o filtro só vale para quadra desta arena.
  const sessao = await exigirSessao();
  const params = await searchParams;
  const db = poolCompartilhado();
  const agora = new Date();
  const quadras = await listarQuadras(db, sessao.arenaId);
  const quadra = quadraDoFiltro(params.quadra, quadras);
  const dia = lerDiaDono(params.dia, agora);
  const mes = lerMesDono(params.mes, dia, agora);
  const pagina = lerPagina(params.pagina);
  const verMes = primeiro(params.ver) === "mes";
  const busca = primeiro(params.busca).trim().slice(0, 60);
  const aviso = mensagemOkAgenda(params.ok) ?? mensagemDoBloqueio(params.bloqueados, params.pulados);
  const volta = hrefAgenda({ quadra, dia, mes, pagina, busca, ver: verMes ? "mes" : null });

  const cabeca = (
    <>
      <h1>Reservas</h1>
      {aviso && (
        <p className="ok-form" role="status">
          {aviso}
        </p>
      )}
      <form method="get" role="search" className="ag-busca">
        {quadra && <input type="hidden" name="quadra" value={quadra} />}
        <div className="campo">
          <label htmlFor="ag-busca">Buscar reserva pelo nome do jogador</label>
          <input id="ag-busca" name="busca" type="search" maxLength={60} defaultValue={busca} autoComplete="off" />
        </div>
        <button type="submit" className="botao">
          Buscar
        </button>
        {busca && (
          <a className="botao" href={hrefAgenda({ quadra, dia, mes })}>
            Limpar busca
          </a>
        )}
      </form>
      {quadras.length > 1 && (
        <nav className="hm-esportes" aria-label="Filtrar por quadra">
          <a href={hrefAgenda({ dia, mes, busca })} aria-current={quadra === null ? "page" : undefined}>
            Todas
          </a>
          {quadras.map((q) => (
            <a key={q.id} href={hrefAgenda({ quadra: q.id, dia, mes, busca })} aria-current={quadra === q.id ? "page" : undefined}>
              {q.nome}
            </a>
          ))}
        </nav>
      )}
    </>
  );

  if (quadras.length === 0) {
    return (
      <main className="miolo-largo painel">
        {cabeca}
        <p className="suave">Cadastre uma quadra para ver a agenda.</p>
      </main>
    );
  }

  // Busca pelo jogador: só os resultados, em páginas.
  if (busca) {
    const r = await buscarNaAgenda(db, sessao.arenaId, busca, pagina, agora);
    const itens = quadra ? r.itens.filter((i) => i.quadraId === quadra) : r.itens;
    const paginas = Math.max(1, Math.ceil(r.total / BUSCA_POR_PAGINA));
    return (
      <main className="miolo-largo painel">
        {cabeca}
        <section aria-labelledby="ag-resultado">
          <h2 id="ag-resultado" className="hm-titulo">
            {r.total === 0 ? "Nenhuma reserva encontrada." : r.total === 1 ? "1 reserva encontrada" : `${r.total} reservas encontradas`}
          </h2>
          <ul className="ag-caixinhas">
            {itens.map((i) => (
              <li key={i.id} className={`ag-cx ag-cx-reserva${i.situacao === "cancelada" ? " ag-cx-cancelada" : ""}`}>
                <a className="ag-cx-dia" href={hrefAgenda({ quadra, dia: hojeLocal(i.inicio) })}>
                  {diaPorExtenso(hojeLocal(i.inicio))}
                </a>
                <strong>
                  {intervaloDoItem(i)} · {rotuloQuadra(i.quadra, i.esporte)}
                </strong>
                <span className="ag-cx-nome">{i.jogador ?? "Conta apagada"}</span>
                <span className="suave">{textoDeCentavos(i.totalCentavos ?? 0)}</span>
                <span className={i.situacao === "cancelada" ? "ag-selo ag-selo-off" : "ag-selo"}>{situacao(i)}</span>
                {podeAgir(i) && <CancelarReservaDono reservaId={i.id} descricao={linhaItem(i)} volta={volta} />}
              </li>
            ))}
          </ul>
          <Paginas pagina={pagina} paginas={paginas} href={(p) => hrefAgenda({ quadra, busca, pagina: p })} />
        </section>
      </main>
    );
  }

  const semana = semanaDoDia(dia);
  const mesesDaSemana = [...new Set([mes, ...semana.map((d) => d.slice(0, 7))])];
  const [resumos, itens, comHorarios] = await Promise.all([
    Promise.all(mesesDaSemana.map((m) => resumoDoMes(db, sessao.arenaId, quadra, m, agora))),
    agendaDaArena(db, sessao.arenaId, agora, { de: dia, ate: dia }),
    Promise.all(
      quadras
        .filter((q) => !quadra || q.id === quadra)
        .map(async (q) => ({ id: q.id, nome: q.nome, esporte: q.esporte, horarios: await listarHorarios(db, sessao.arenaId, q.id) })),
    ),
  ]);
  const resumo = resumos[0];
  const porDia = new Map(resumos.flatMap((r) => [...r.porDia]));
  const grupos = caixinhasDoDia(itens, comHorarios, dia, agora);
  const pag = paginarCaixinhas(grupos, pagina);
  const meses = mesesDoDono(agora);
  const iMes = meses.indexOf(mes);
  // Setas da semana só quando o dia de destino ainda está na faixa do calendário.
  const antes = diaMais(dia, -7);
  const depois = diaMais(dia, 7);
  const temAntes = lerDiaDono(antes, agora) === antes;
  const temDepois = lerDiaDono(depois, agora) === depois;

  return (
    <main className="miolo-largo painel">
      {cabeca}
      <div className="ag-metades">
        <aside className="ag-lado" aria-label="Calendário">
          <nav className={verMes ? "ag-semana ag-escondida-celular" : "ag-semana"} aria-label="Dias da semana">
            {temAntes ? (
              <a href={hrefAgenda({ quadra, dia: antes })} aria-label="Semana anterior" className="ag-seta">
                ‹
              </a>
            ) : (
              <span />
            )}
            {semana.map((d) => {
              const n = porDia.get(d) ?? 0;
              return (
                <a
                  key={d}
                  href={hrefAgenda({ quadra, dia: d })}
                  className={d === dia ? "ag-semana-dia ag-escolhido" : "ag-semana-dia"}
                  aria-current={d === dia ? "date" : undefined}
                >
                  <span>{DIA_CURTO.format(new Date(`${d}T12:00:00Z`)).replace(".", "")}</span>
                  <strong>{Number(d.slice(8))}</strong>
                  <em>{n > 0 ? n : "·"}</em>
                </a>
              );
            })}
            {temDepois ? (
              <a href={hrefAgenda({ quadra, dia: depois })} aria-label="Próxima semana" className="ag-seta">
                ›
              </a>
            ) : (
              <span />
            )}
          </nav>
          <a className="ag-ver-mes" href={hrefAgenda({ quadra, dia, mes, ver: verMes ? null : "mes" })}>
            {verMes ? "Ver só a semana" : "Ver mês inteiro"}
          </a>

          <div className={verMes ? "ag-mes" : "ag-mes ag-escondida-celular"}>
            <div className="ar-mes">
              <strong>{nomeDoMes(mes)}</strong>
              <span className="ar-mes-nav">
                {iMes > 0 ? (
                  <a href={hrefAgenda({ quadra, dia, mes: meses[iMes - 1], ver: verMes ? "mes" : null })} aria-label="Mês anterior">
                    ‹
                  </a>
                ) : (
                  <span aria-hidden="true" />
                )}
                <span />
                {iMes < meses.length - 1 ? (
                  <a href={hrefAgenda({ quadra, dia, mes: meses[iMes + 1], ver: verMes ? "mes" : null })} aria-label="Próximo mês">
                    ›
                  </a>
                ) : (
                  <span aria-hidden="true" />
                )}
              </span>
            </div>
            <table className="ar-calendario ag-calendario">
              <thead>
                <tr>
                  {SEMANA.map((s) => (
                    <th key={s} scope="col">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calendarioDoDono(mes, porDia, dia, agora).map((sem) => (
                  <tr key={sem[0].dia}>
                    {sem.map((d) => (
                      <td key={d.dia} className={d.doMes ? (d.escolhido ? "ag-dia ag-escolhido" : "ag-dia") : "ag-dia ag-dia-fora"}>
                        {d.doMes && d.naFaixa ? (
                          <a
                            href={hrefAgenda({ quadra, dia: d.dia, mes, ver: verMes ? "mes" : null })}
                            aria-current={d.escolhido ? "date" : undefined}
                            aria-label={`${d.numero}${d.n > 0 ? `, ${d.n} ${d.n === 1 ? "reserva" : "reservas"}` : ""}`}
                            className={d.hoje ? "ag-hoje" : undefined}
                          >
                            {d.numero}
                            {d.n > 0 && <em aria-hidden="true">{d.n}</em>}
                          </a>
                        ) : (
                          <span aria-hidden={d.doMes ? undefined : true}>{d.numero}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="ag-numeros">
            <div>
              <dt>reservas hoje</dt>
              <dd>{resumo.hoje}</dd>
            </div>
            <div>
              <dt>esta semana</dt>
              <dd>{resumo.semana}</dd>
            </div>
            <div>
              <dt>a receber em {nomeDoMes(mes).split(" ")[0].toLowerCase()}</dt>
              <dd>{reais(resumo.aReceberCentavos)}</dd>
            </div>
          </dl>
        </aside>

        <section className="cartao ar-cartao ag-dia-lado" aria-labelledby="ag-titulo-dia">
          <h2 id="ag-titulo-dia" className="ar-titulo">
            {diaPorExtenso(dia)}
          </h2>
          {pag.grupos.map((g) => {
            const todos = grupos.find((x) => x.quadraId === g.quadraId)?.livres ?? [];
            return (
              <div key={g.quadraId} className="ag-grupo">
                <div className="ag-grupo-topo">
                  <h3>{[g.quadra, g.esporte].filter(Boolean).join(" · ")}</h3>
                  {todos.length > 1 && (
                    <Bloquear
                      quadraId={g.quadraId}
                      dia={dia}
                      horarios={todos}
                      rotulo="Bloquear o dia todo"
                      descricao={`os ${todos.length} horários livres de ${g.quadra} neste dia`}
                      volta={volta}
                    />
                  )}
                </div>
                {g.caixinhas.length === 0 ? (
                  <p className="suave">Nada neste dia.</p>
                ) : (
                  <ul className="ag-caixinhas">
                    {g.caixinhas.map((c) => (
                      <CaixinhaDoDia
                        key={`${c.tipo}-${c.inicio}-${c.tipo === "livre" ? "" : c.item.id}`}
                        c={c}
                        quadraId={g.quadraId}
                        dia={dia}
                        volta={volta}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <Paginas pagina={pag.pagina} paginas={pag.paginas} href={(p) => hrefAgenda({ quadra, dia, mes, pagina: p, ver: verMes ? "mes" : null })} />
        </section>
      </div>
    </main>
  );
}

// Dia somado de n dias (AAAA-MM-DD); quem lê a URL confere a faixa.
function diaMais(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

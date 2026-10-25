import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoDeCentavos } from "@/app/lib/precos";
import { reservasDoJogador, type ReservaJogador } from "@/app/lib/reservas";
import { linkComoChegar, textoLances } from "@/app/a/[slug]/apresentacao";
import { cancelarReservaAction } from "./actions";
import {
  hrefLista, hrefReservarDeNovo, lerAba, mensagemOk, paginar, seloDaReserva, textoCancelaAte, textoHorario, type Aba,
} from "./apresentacao";
import { SeloData, SeloSituacao } from "./cartao";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Minhas reservas",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function Cartao({ r, aba, agora, indice }: { r: ReservaJogador; aba: Aba; agora: Date; indice: number }) {
  const passada = aba === "historico";
  const comoChegar = passada ? null : linkComoChegar(r.arena);
  const quadra = r.esporte ? `${r.quadra} · ${r.esporte}` : r.quadra;
  return (
    <li className="rv-cartao">
      <span className={`rv-foto rv-foto-${indice % 2}`} aria-hidden="true" />
      <div className="rv-corpo">
        <div className="rv-cabeca">
          <SeloData inicio={r.inicio} passada={passada} />
          <div>
            <h2 className="rv-arena">
              <Link href={`/a/${encodeURIComponent(r.arena.slug)}`}>{r.arena.nome}</Link>
            </h2>
            <p className="rv-quadra">{quadra}</p>
          </div>
        </div>
        <p className="rv-linha">
          {textoHorario(r.inicio, r.fim)} · <b>{textoDeCentavos(r.totalCentavos)}</b>
        </p>
        <p className="rv-selos">
          <SeloSituacao {...seloDaReserva(r, agora)} />
          {passada && r.lances > 0 && <span className="rv-selo rv-selo-lances">{textoLances(r.lances)}</span>}
        </p>
        {!passada && (r.pagamento === "arena" || r.podeCancelar) && (
          <p className="rv-nota">
            {r.pagamento === "arena" ? "Pagamento na arena" : null}
            {r.pagamento === "arena" && r.podeCancelar ? " · " : null}
            {r.podeCancelar ? textoCancelaAte(r.inicio) : null}
          </p>
        )}
        <div className="rv-acoes">
          {passada ? (
            <>
              {r.lances > 0 && (
                <Link className="botao botao-cheio" href={`/minhas-reservas/${encodeURIComponent(r.id)}`}>
                  Ver lances
                </Link>
              )}
              <Link className="botao" href={hrefReservarDeNovo(r.arena.slug, r.quadraId)}>
                Reservar de novo
              </Link>
            </>
          ) : (
            <>
              {comoChegar && (
                <a className="botao" href={comoChegar} target="_blank" rel="noopener noreferrer">
                  Como chegar
                </a>
              )}
              {r.podeCancelar && (
                <Confirmar
                  acao={cancelarReservaAction}
                  campo="reservaId"
                  valor={r.id}
                  rotulo="Cancelar"
                  pergunta="Cancelar esta reserva? O horário volta a ficar livre."
                  confirmar="Sim, cancelar reserva"
                />
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function Paginas({ aba, pagina, totalPaginas }: { aba: Aba; pagina: number; totalPaginas: number }) {
  if (totalPaginas <= 1) return null;
  const numeros = Array.from({ length: totalPaginas }, (_, i) => i + 1);
  return (
    <nav className="rv-paginas" aria-label="Páginas">
      {pagina > 1 && (
        <Link href={hrefLista(aba, pagina - 1)} aria-label="Página anterior">
          ‹
        </Link>
      )}
      {numeros.map((n) => (
        <Link key={n} href={hrefLista(aba, n)} aria-current={n === pagina ? "page" : undefined}>
          {n}
        </Link>
      ))}
      {pagina < totalPaginas && (
        <Link href={hrefLista(aba, pagina + 1)} aria-label="Próxima página">
          ›
        </Link>
      )}
    </nav>
  );
}

export default async function MinhasReservas({ searchParams }: Props) {
  const sessao = await exigirJogador("/minhas-reservas");
  const params = await searchParams;
  const ok = mensagemOk(params.ok);
  const aba = lerAba(params.aba);
  const agora = new Date();
  const { proximas, historico } = await reservasDoJogador(poolCompartilhado(), sessao.jogadorId, agora);
  const { itens, pagina, totalPaginas } = paginar(aba === "historico" ? historico : proximas, params.pagina);
  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo-largo rv">
        <h1>Minhas reservas</h1>
        {ok && (
          <p className="ok-form" role="status">
            {ok}
          </p>
        )}
        <div className="rv-painel">
          <nav className="rv-abas" aria-label="Reservas">
            <Link href={hrefLista("proximas", 1)} aria-current={aba === "proximas" ? "page" : undefined}>
              Próximas ({proximas.length})
            </Link>
            <Link href={hrefLista("historico", 1)} aria-current={aba === "historico" ? "page" : undefined}>
              Histórico ({historico.length})
            </Link>
          </nav>
          {itens.length === 0 ? (
            <div className="rv-vazio">
              {aba === "proximas" ? (
                <>
                  <p>Nenhuma reserva marcada.</p>
                  <Link className="botao botao-cheio" href="/">
                    Buscar quadras
                  </Link>
                </>
              ) : (
                <p>Nada no histórico ainda.</p>
              )}
            </div>
          ) : (
            <ul className="rv-grade">
              {itens.map((r, i) => (
                <Cartao key={r.id} r={r} aba={aba} agora={agora} indice={i} />
              ))}
            </ul>
          )}
          <Paginas aba={aba} pagina={pagina} totalPaginas={totalPaginas} />
        </div>
      </main>
    </>
  );
}

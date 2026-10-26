import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoDeCentavos } from "@/app/lib/precos";
import { reservasDoJogador, type ReservaJogador } from "@/app/lib/reservas";
import { linkComoChegar, textoLances } from "@/app/a/[slug]/apresentacao";
import { cancelarReservaAction, pagarReservaAction } from "./actions";
import {
  hrefLista, hrefReservarDeNovo, lerAba, mensagemOk, paginar, seloDaReserva, textoCancelaAte, textoEstornoReserva, textoHorario,
  textoPagarAte, type Aba,
} from "./apresentacao";
import { CancelarIndisponivel } from "./cancelar-indisponivel";
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
  const estorno = textoEstornoReserva(r);
  const online = r.pagamento === "online";
  // O cancelamento de reserva paga online devolve o valor sem a tarifa do Asaas.
  const pergunta = online && r.liquidoCentavos != null
    ? `Cancelar esta reserva? O horário volta a ficar livre e você recebe ${textoDeCentavos(r.liquidoCentavos)} de volta (a tarifa do Asaas não é devolvida).`
    : "Cancelar esta reserva? O horário volta a ficar livre.";
  return (
    <li className="rv-cartao">
      <span className={`rv-foto rv-foto-${indice % 2}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- rota própria, já com cache */}
        {r.fotoId && <img src={`/fotos/${r.fotoId}`} alt="" loading="lazy" />}
      </span>
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
        {r.situacao === "segurada" && r.seguraAte ? (
          <p className="rv-nota">{textoPagarAte(r.seguraAte)}</p>
        ) : (
          !passada && (r.pagamento === "arena" || online || r.podeCancelar) && (
            <p className="rv-nota">
              {r.pagamento === "arena" ? "Pagamento na arena" : online ? "Pago online" : null}
              {(r.pagamento === "arena" || online) && r.podeCancelar ? " · " : null}
              {r.podeCancelar ? textoCancelaAte(r.inicio, !online) : null}
            </p>
          )
        )}
        {estorno && <p className="rv-nota">{estorno}</p>}
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
              {r.situacao === "segurada" ? (
                <form action={pagarReservaAction}>
                  <input type="hidden" name="reservaId" value={r.id} />
                  <button type="submit" className="botao botao-cheio">
                    Pagar
                  </button>
                </form>
              ) : r.podeCancelar ? (
                <Confirmar
                  acao={cancelarReservaAction}
                  campo="reservaId"
                  valor={r.id}
                  rotulo="Cancelar"
                  pergunta={pergunta}
                  confirmar="Cancelar"
                />
              ) : (
                <CancelarIndisponivel />
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

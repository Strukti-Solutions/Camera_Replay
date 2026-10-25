import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LinkVoltar } from "@/app/componentes/voltar";
import { diaPorExtenso, hrefReservar, lerReserva } from "@/app/a/[slug]/apresentacao";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { arenaPublica, periodosPublicos, slugDaQuadra } from "@/app/lib/arenas-publicas";
import { escolhaDeHorarios } from "@/app/lib/disponibilidade";
import { textoMinutos } from "@/app/lib/horarios";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoDeCentavos } from "@/app/lib/precos";
import { MSG_INDISPONIVEL } from "@/app/lib/reservas";
import { FormularioReservar } from "./formulario";

// O "agora" e as reservas dos outros decidem se o horário ainda está livre.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirmar reserva",
  robots: { index: false, follow: false },
};

type Parametros = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<Parametros> };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const textoHorarios = (n: number) => (n === 1 ? "1 horário" : `${n} horários`);
const intervalo = (h: { inicio: number; fim: number }) => `${textoMinutos(h.inicio)}–${textoMinutos(h.fim)}`;

// Resumo da reserva escolhida na página da arena (/reservar?quadra=&dia=&inicio=&qtd=).
// Sem jogador, vai para /entrar e volta para cá com a mesma escolha.
export default async function PaginaReservar({ searchParams }: Props) {
  const params = await searchParams;
  const cru = {
    quadra: primeiro(params.quadra),
    dia: primeiro(params.dia),
    inicio: primeiro(params.inicio),
    qtd: primeiro(params.qtd),
  };
  const sessao = await exigirJogador(hrefReservar(cru));

  const db = poolCompartilhado();
  const agora = new Date();
  const slug = await slugDaQuadra(db, cru.quadra);
  const arena = slug ? await arenaPublica(db, slug) : null;
  const escolha = arena?.ativa ? lerReserva(params, arena.quadras.map((q) => q.id), agora) : null;
  const quadra = escolha ? arena!.quadras.find((q) => q.id === escolha.quadra) : undefined;
  const preco =
    escolha && quadra
      ? escolhaDeHorarios(
          quadra.horarios, escolha.dia, escolha.inicio, escolha.qtd, agora,
          await periodosPublicos(db, quadra.id, escolha.dia),
        )
      : null;

  if (!arena || !escolha || !quadra || !preco) {
    return (
      <>
        <CabecalhoPublico sessao={sessao} voltar={hrefReservar(cru)} />
        <main className="miolo aviso">
          <p>{MSG_INDISPONIVEL}</p>
          {slug ? (
            <Link className="botao" href={`/a/${slug}`}>
              Escolher outro horário
            </Link>
          ) : (
            <Link className="botao" href="/">
              Voltar ao início
            </Link>
          )}
        </main>
      </>
    );
  }

  const volta = `/a/${arena.slug}?${new URLSearchParams({
    quadra: quadra.id, dia: escolha.dia, inicio: String(preco.inicio), qtd: String(preco.itens.length),
  }).toString()}#reserva`;

  return (
    <>
      <CabecalhoPublico sessao={sessao} voltar={hrefReservar(cru)} />
      <main className="miolo reservar">
        <LinkVoltar href={volta} />
        <h1>Confirmar reserva</h1>
        <dl className="reservar-resumo">
          <div>
            <dt>Arena</dt>
            <dd>{arena.nome}</dd>
          </div>
          <div>
            <dt>Quadra</dt>
            <dd>{quadra.nome}</dd>
          </div>
          <div>
            <dt>Dia</dt>
            <dd>{diaPorExtenso(escolha.dia)}</dd>
          </div>
          <div>
            <dt>Horário</dt>
            <dd>
              {textoMinutos(preco.inicio)} às {textoMinutos(preco.fim)} ({textoHorarios(preco.itens.length)})
            </dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>
              <strong>{textoDeCentavos(preco.totalCentavos)}</strong>
              {preco.itens.length > 1 && (
                <span className="suave reservar-detalhe">
                  {preco.itens.map((h) => `${intervalo(h)} ${textoDeCentavos(h.precoCentavos)}`).join(" · ")}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Pagamento</dt>
            <dd>Pagamento na arena</dd>
          </div>
        </dl>
        <p className="suave">Cancelamento grátis até 24 h antes.</p>
        <FormularioReservar quadra={quadra.id} dia={escolha.dia} inicio={preco.inicio} qtd={preco.itens.length} />
      </main>
    </>
  );
}

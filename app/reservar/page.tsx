import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LinkVoltar } from "@/app/componentes/voltar";
import { diaPorExtenso, hrefReservar, lerReserva } from "@/app/a/[slug]/apresentacao";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { arenaPublica, ocupadasPublicas, slugDaQuadra } from "@/app/lib/arenas-publicas";
import { precoEscolha } from "@/app/lib/disponibilidade";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoDeCentavos, textoHora } from "@/app/lib/precos";
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
const textoHoras = (n: number) => (n === 1 ? "1 hora" : `${n} horas`);

// Resumo da reserva escolhida na página da arena (/reservar?quadra=&dia=&inicio=&horas=).
// Sem jogador, vai para /entrar e volta para cá com a mesma escolha.
export default async function PaginaReservar({ searchParams }: Props) {
  const params = await searchParams;
  const cru = {
    quadra: primeiro(params.quadra),
    dia: primeiro(params.dia),
    inicio: primeiro(params.inicio),
    horas: primeiro(params.horas),
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
      ? precoEscolha(
          quadra.faixas, escolha.dia, escolha.inicio, escolha.horas, agora,
          await ocupadasPublicas(db, quadra.id, escolha.dia),
        )
      : null;

  if (!arena || !escolha || !quadra || !preco) {
    return (
      <>
        <CabecalhoPublico sessao={sessao} />
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
    quadra: quadra.id, dia: escolha.dia, inicio: String(preco.hora), horas: String(preco.horas),
  }).toString()}#quadra-${quadra.id}`;

  return (
    <>
      <CabecalhoPublico sessao={sessao} />
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
              {textoHora(preco.hora)} às {textoHora(preco.hora + preco.horas)} ({textoHoras(preco.horas)})
            </dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>
              <strong>{textoDeCentavos(preco.totalCentavos)}</strong>
              <span className="suave reservar-detalhe">
                {preco.porHora.map((h) => `${textoHora(h.hora)} ${textoDeCentavos(h.precoCentavos)}`).join(" · ")}
              </span>
            </dd>
          </div>
          <div>
            <dt>Pagamento</dt>
            <dd>Pagamento na arena</dd>
          </div>
        </dl>
        <p className="suave">Cancelamento grátis até 24 h antes.</p>
        <FormularioReservar quadra={quadra.id} dia={escolha.dia} inicio={preco.hora} horas={preco.horas} />
      </main>
    </>
  );
}

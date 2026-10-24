import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoDeCentavos } from "@/app/lib/precos";
import { reservasDoJogador, type ReservaJogador } from "@/app/lib/reservas";
import { textoLances } from "@/app/a/[slug]/apresentacao";
import { cancelarReservaAction } from "./actions";
import { mensagemOk, rotuloSituacao, textoPeriodo } from "./apresentacao";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Minhas reservas",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function Item({ r }: { r: ReservaJogador }) {
  return (
    <li className="lance">
      <div className="lance-cabeca">
        <h3>
          <Link href={`/a/${r.arena.slug}`}>{r.arena.nome}</Link> · {r.quadra}
        </h3>
        <p className="lance-meta">
          <span className="selo">{rotuloSituacao(r.situacao, r.canceladaPor, r.motivoCancelamento)}</span>
        </p>
      </div>
      <p>{textoPeriodo(r.inicio, r.fim)}</p>
      <p>
        {textoDeCentavos(r.totalCentavos)}
        {r.pagamento === "arena" && " · Pagamento na arena"}
      </p>
      {r.lances > 0 && (
        <p>
          <Link href={`/minhas-reservas/${r.id}`}>Ver lances ({r.lances})</Link>
          <span className="lance-meta"> · {textoLances(r.lances)}</span>
        </p>
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
    </li>
  );
}

export default async function MinhasReservas({ searchParams }: Props) {
  const sessao = await exigirJogador("/minhas-reservas");
  const ok = mensagemOk((await searchParams).ok);
  const { proximas, historico } = await reservasDoJogador(poolCompartilhado(), sessao.jogadorId, new Date());
  const primeiroNome = sessao.nome.trim().split(/\s+/)[0] ?? sessao.nome;
  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo entrar">
        <h1>Olá, {primeiroNome}</h1>
        {ok && (
          <p className="ok-form" role="status">
            {ok}
          </p>
        )}
        <h2>Próximas</h2>
        {proximas.length === 0 ? (
          <p>Você não tem reservas próximas.</p>
        ) : (
          <ol className="lances">
            {proximas.map((r) => (
              <Item key={r.id} r={r} />
            ))}
          </ol>
        )}
        <h2>Histórico</h2>
        {historico.length === 0 ? (
          <p>Nada por aqui ainda.</p>
        ) : (
          <ol className="lances">
            {historico.map((r) => (
              <Item key={r.id} r={r} />
            ))}
          </ol>
        )}
        <p className="entrar-links">
          <Link href="/minha-conta">Minha conta</Link>
        </p>
      </main>
    </>
  );
}

import type { Metadata } from "next";
import { diaPorExtenso } from "@/app/a/[slug]/apresentacao";
import { diasDisponiveis, hojeLocal } from "@/app/lib/disponibilidade";
import { listarQuadras } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { agendaDaArena } from "@/app/lib/reservas";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { removerBloqueioAction } from "./actions";
import { dividirAgenda, intervaloAgenda, linhaItem, mensagemOkAgenda, porDia, quadraDoFiltro } from "./apresentacao";
import { CancelarReservaDono, FormularioBloqueio } from "./formularios";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reservas",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PaginaReservas({ searchParams }: Props) {
  // Tudo sai do arenaId da sessão; o filtro só vale para quadra desta arena.
  const sessao = await exigirSessao();
  const busca = await searchParams;
  const db = poolCompartilhado();
  const agora = new Date();
  const quadras = await listarQuadras(db, sessao.arenaId);
  const filtro = quadraDoFiltro(busca.quadra, quadras);
  const ok = mensagemOkAgenda(busca.ok);

  const { de, ate, dias } = intervaloAgenda(agora);
  const itens = (await agendaDaArena(db, sessao.arenaId, agora, { de, ate })).filter(
    (i) => !filtro || i.quadraId === filtro,
  );
  const { proximas, historico } = dividirAgenda(itens, agora);
  const agenda = porDia(dias, proximas);

  return (
    <main className="miolo painel">
      <h1>Reservas</h1>
      {ok && (
        <p className="ok-form" role="status">
          {ok}
        </p>
      )}

      {quadras.length > 0 && (
        <form method="get" className="formulario">
          <div className="campo">
            <label htmlFor="filtro-quadra">Quadra</label>
            <select id="filtro-quadra" name="quadra" defaultValue={filtro ?? ""}>
              <option value="">Todas as quadras</option>
              {quadras.map((q) => <option key={q.id} value={q.id}>{q.nome}</option>)}
            </select>
          </div>
          <button type="submit" className="botao">Filtrar</button>
        </form>
      )}

      <section className="secao" aria-labelledby="titulo-agenda">
        <h2 id="titulo-agenda">Próximos 14 dias</h2>
        {agenda.map((g) => (
          <div key={g.dia}>
            <h3>{diaPorExtenso(g.dia)}</h3>
            {g.itens.length === 0 ? (
              <p className="suave">Nada marcado.</p>
            ) : (
              <ul className="faixas">
                {g.itens.map((i) => {
                  const linha = linhaItem(i);
                  return (
                    <li key={i.id} className="faixa-preco">
                      <span>{linha}</span>
                      {i.futura && i.tipo === "reserva" && <CancelarReservaDono reservaId={i.id} descricao={linha} />}
                      {i.futura && i.tipo === "bloqueio" && (
                        <Confirmar
                          acao={removerBloqueioAction}
                          campo="reservaId"
                          valor={i.id}
                          rotulo="Remover"
                          pergunta={`Remover o bloqueio ${linha}? O horário volta a ficar livre.`}
                          confirmar="Sim, remover bloqueio"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </section>

      <section className="secao" aria-labelledby="titulo-bloquear">
        <h2 id="titulo-bloquear">Bloquear horário</h2>
        {quadras.length === 0 ? (
          <p className="suave">Cadastre uma quadra para bloquear horários.</p>
        ) : (
          <FormularioBloqueio quadras={quadras.map((q) => ({ id: q.id, nome: q.nome }))} dias={diasDisponiveis(agora)} />
        )}
      </section>

      <section className="secao" aria-labelledby="titulo-historico">
        <h2 id="titulo-historico">Últimos 30 dias</h2>
        {historico.length === 0 ? (
          <p className="suave">Nada por aqui ainda.</p>
        ) : (
          <ul className="faixas">
            {historico.map((i) => (
              <li key={i.id} className="faixa-preco">
                <span>{`${diaPorExtenso(hojeLocal(i.inicio))} · ${linhaItem(i)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

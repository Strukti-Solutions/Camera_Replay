import type { Metadata } from "next";
import Link from "next/link";
import { listarAlunosParaEscolha } from "@/app/lib/alunos";
import { listarQuadras } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { listarReservas } from "@/app/lib/reservas";
import { textoData, textoReserva } from "@/app/painel/apresentacao";
import { AvataresEmpilhados } from "@/app/componentes/avatar";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { removerReservaAction } from "./actions";
import { FormularioNovaReserva } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reservas",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ ok?: string | string[] }> };

export default async function PaginaReservas({ searchParams }: Props) {
  // A página confere a sessão por conta própria e usa só o arenaId dela.
  const sessao = await exigirSessao();
  const db = poolCompartilhado();
  // Últimos 30 dias e as futuras: reserva antiga sai da lista (a função filtra fim >= desde).
  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [reservas, quadras, alunosArena] = await Promise.all([
    listarReservas(db, sessao.arenaId, { desde }),
    listarQuadras(db, sessao.arenaId),
    listarAlunosParaEscolha(db, sessao.arenaId),
  ]);
  const alunos = alunosArena;
  // ?ok= é só uma chave: o texto mostrado é fixo, nada da URL vai para a tela.
  const { ok } = await searchParams;
  const mensagem = ok === "alunos" ? "Alunos da reserva salvos." : "";

  return (
    <main className="miolo painel">
      <h1>Reservas</h1>
      <p className="ok-form" role="status">
        {mensagem}
      </p>

      {reservas.length === 0 ? (
        <p className="painel-vazio">Nenhuma reserva cadastrada.</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <caption className="so-leitor">Reservas da arena</caption>
            <thead>
              <tr>
                <th scope="col">Quadra</th>
                <th scope="col">Horário</th>
                <th scope="col">Alunos</th>
                <th scope="col" className="num">
                  Lances
                </th>
                <th scope="col">
                  <span className="so-leitor">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => (
                <tr key={r.id}>
                  <td>{r.quadraNome}</td>
                  <td>
                    <div className="pessoa-nome num-tab">{textoReserva(r.inicio, r.fim)}</div>
                    <div className="suave num-tab">{textoData(r.inicio)}</div>
                  </td>
                  <td>
                    {r.alunos.length > 0 ? (
                      <AvataresEmpilhados alunos={r.alunos} />
                    ) : (
                      <span className="selo-neutro">Sem alunos</span>
                    )}
                  </td>
                  <td className="num">{r.lances}</td>
                  <td>
                    <div className="acoes-linha">
                      <Link className="botao" href={`/painel/reservas/${r.id}/alunos`}>
                        Editar alunos
                      </Link>
                      <Confirmar
                        acao={removerReservaAction}
                        campo="reservaId"
                        valor={r.id}
                        rotulo="Remover"
                        pergunta="A reserva é apagada. Os lances continuam no painel da quadra."
                        confirmar="Confirmar: remover reserva"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="secao">
        {quadras.length === 0 ? (
          <p className="suave">
            Cadastre uma quadra antes de criar reservas. <Link href="/painel">Ir para Quadras</Link>
          </p>
        ) : alunos.length === 0 ? (
          <p className="suave">
            Cadastre um aluno antes de criar reservas. <Link href="/painel/alunos">Ir para Alunos</Link>
          </p>
        ) : (
          <FormularioNovaReserva quadras={quadras.map((q) => ({ id: q.id, nome: q.nome }))} alunos={alunos} />
        )}
      </section>
    </main>
  );
}

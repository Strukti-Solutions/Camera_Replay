import type { Metadata } from "next";
import Link from "next/link";
import { listarAlunos } from "@/app/lib/alunos";
import { listarQuadras } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { listarReservas } from "@/app/lib/reservas";
import { textoData, textoReserva } from "@/app/painel/apresentacao";
import { AvataresEmpilhados } from "@/app/componentes/avatar";
import { EditarAlunos } from "@/app/painel/escolha-alunos";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { definirAlunosAction, removerReservaAction } from "./actions";
import { FormularioNovaReserva } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reservas",
  robots: { index: false, follow: false },
};

export default async function PaginaReservas() {
  // A página confere a sessão por conta própria e usa só o arenaId dela.
  const sessao = await exigirSessao();
  const db = poolCompartilhado();
  const [reservas, quadras, alunosArena] = await Promise.all([
    listarReservas(db, sessao.arenaId),
    listarQuadras(db, sessao.arenaId),
    listarAlunos(db, sessao.arenaId),
  ]);
  const alunos = alunosArena.map((a) => ({ id: a.id, nome: a.nome }));

  return (
    <main className="miolo painel">
      <h1>Reservas</h1>

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
                      {alunos.length > 0 && (
                        <EditarAlunos
                          acao={definirAlunosAction}
                          campo="reservaId"
                          valor={r.id}
                          alunos={alunos}
                          marcados={r.alunos.map((a) => a.id)}
                          rotulo="Editar alunos"
                          legenda="Alunos da reserva"
                          salvar="Salvar alunos"
                          salvo="Alunos da reserva salvos."
                        />
                      )}
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

import type { Metadata } from "next";
import { listarAlunos } from "@/app/lib/alunos";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoData } from "@/app/painel/apresentacao";
import { Avatar } from "@/app/painel/avatar";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { removerAlunoAction } from "./actions";
import { FormularioNovoAluno, RedefinirSenha } from "./formularios";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Alunos",
  robots: { index: false, follow: false },
};

export default async function PaginaAlunos() {
  // A página confere a sessão por conta própria e usa só o arenaId dela.
  const sessao = await exigirSessao();
  const alunos = await listarAlunos(poolCompartilhado(), sessao.arenaId);

  return (
    <main className="miolo painel">
      <h1>Alunos</h1>

      {alunos.length === 0 ? (
        <p className="painel-vazio">Nenhum aluno cadastrado.</p>
      ) : (
        // A rolagem horizontal é do invólucro: no celular a tabela é mais
        // larga que a tela, e esconder colunas tiraria o que o dono veio ver.
        <div className="tabela-rolagem">
          <table className="tabela">
            <caption className="so-leitor">Alunos da arena</caption>
            <thead>
              <tr>
                <th scope="col">Aluno</th>
                <th scope="col" className="num">
                  Reservas
                </th>
                <th scope="col">Cadastrado em</th>
                <th scope="col">
                  <span className="so-leitor">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {alunos.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="pessoa">
                      <Avatar id={a.id} nome={a.nome} />
                      <div className="pessoa-texto">
                        <div className="pessoa-nome">{a.nome}</div>
                        <div className="pessoa-email">{a.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{a.reservas}</td>
                  <td className="suave num-tab">{textoData(a.criadoEm)}</td>
                  <td>
                    <div className="acoes-linha">
                      <RedefinirSenha alunoId={a.id} />
                      <Confirmar
                        acao={removerAlunoAction}
                        campo="alunoId"
                        valor={a.id}
                        rotulo="Remover"
                        pergunta="O aluno perde o acesso aos lances e sai das reservas. Não dá para desfazer."
                        confirmar="Confirmar: remover aluno"
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
        <FormularioNovoAluno />
      </section>
    </main>
  );
}

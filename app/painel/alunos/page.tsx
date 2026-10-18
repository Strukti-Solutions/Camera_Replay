import type { Metadata } from "next";
import { termoDaBusca } from "@/app/escolha-arena";
import { listarAlunos } from "@/app/lib/alunos";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoData } from "@/app/painel/apresentacao";
import { Avatar } from "@/app/componentes/avatar";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { removerAlunoAction } from "./actions";
import { FormularioNovoAluno, RedefinirSenha } from "./formularios";
import { hrefPaginaAlunos, lerPagina, textoTotalAlunos } from "./navegacao";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Alunos",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ busca?: string | string[]; pagina?: string | string[] }> };

// Busca e páginas vêm da URL (?busca=&pagina=): formulário GET e links comuns,
// então tudo funciona sem JavaScript.
export default async function PaginaAlunos({ searchParams }: Props) {
  // A página confere a sessão por conta própria e usa só o arenaId dela.
  const sessao = await exigirSessao();
  const params = await searchParams;
  const busca = termoDaBusca(params.busca);
  const { alunos, total, pagina, paginas } = await listarAlunos(poolCompartilhado(), sessao.arenaId, {
    busca,
    pagina: lerPagina(params.pagina),
  });

  return (
    <main className="miolo painel">
      <h1>Alunos</h1>

      <form action="/painel/alunos" method="get" role="search" className="escolha-busca" aria-label="Buscar aluno">
        <div className="campo">
          {/* A dica fica no rótulo: embaixo do campo ela desalinharia o botão. */}
          <label htmlFor="busca-aluno">
            Buscar aluno <span className="suave">(nome ou e-mail)</span>
          </label>
          <input id="busca-aluno" name="busca" type="search" defaultValue={busca} maxLength={80} autoComplete="off" />
        </div>
        <button type="submit" className="botao">
          Buscar
        </button>
      </form>

      {total > 0 && <p className="suave alunos-total">{textoTotalAlunos(total)}</p>}

      {alunos.length === 0 ? (
        <p className="painel-vazio">{busca ? "Nenhum aluno encontrado." : "Nenhum aluno cadastrado."}</p>
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

      {paginas > 1 && (
        <nav className="paginacao" aria-label="Páginas da lista de alunos">
          <LinkPagina href={pagina > 1 ? hrefPaginaAlunos(busca, pagina - 1) : null} rotulo="Anterior" />
          <span className="paginacao-texto">
            Página {pagina} de {paginas}
          </span>
          <LinkPagina href={pagina < paginas ? hrefPaginaAlunos(busca, pagina + 1) : null} rotulo="Próxima" />
        </nav>
      )}

      <section className="secao">
        <FormularioNovoAluno />
      </section>
    </main>
  );
}

// Na ponta da lista o link fica sem href (não navega nem recebe foco) e é
// anunciado como link indisponível.
function LinkPagina({ href, rotulo }: { href: string | null; rotulo: string }) {
  if (href === null) {
    return (
      <a role="link" aria-disabled="true" className="botao paginacao-botao">
        {rotulo}
      </a>
    );
  }
  return (
    <a href={href} className="botao paginacao-botao">
      {rotulo}
    </a>
  );
}

import type { Metadata } from "next";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LIMITE_PUBLICO, listarArenasPublicas } from "@/app/lib/arenas-publicas";
import { poolCompartilhado } from "@/app/lib/pool";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";
import { termoDaBusca } from "./escolha-arena";

// A lista segue o status das arenas (suspensa sai na hora): nada de cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Escolha sua arena" };

type Props = { searchParams: Promise<{ busca?: string | string[]; ok?: string | string[] }> };

// Porta de entrada pública: o jogador escolhe a arena e segue para /a/<slug>.
// Só nome e slug das arenas ativas aparecem aqui. A busca é um formulário GET
// comum, então funciona sem JavaScript.
export default async function EscolhaDaArena({ searchParams }: Props) {
  const params = await searchParams;
  const busca = termoDaBusca(params.busca);
  // Texto fixo: só o valor exato do redirecionamento liga o aviso, nada é refletido.
  const contaApagada = params.ok === "conta-apagada";
  const sessao = await sessaoJogadorAtual();
  const arenas = await listarArenasPublicas(poolCompartilhado(), busca);

  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo escolha">
        {contaApagada && (
          <p className="ok-form" role="status">
            Conta apagada.
          </p>
        )}
        <h1>Escolha sua arena</h1>
        <form action="/" method="get" role="search" className="escolha-busca">
          <div className="campo">
            <label htmlFor="busca">Buscar arena</label>
            <input id="busca" name="busca" type="search" defaultValue={busca} maxLength={80} autoComplete="off" />
          </div>
          <button type="submit" className="botao">
            Buscar
          </button>
        </form>

        {arenas.length === 0 ? (
          <p className="escolha-vazia">Nenhuma arena encontrada.</p>
        ) : (
          <ul className="escolha-lista">
            {arenas.map((a) => (
              <li key={a.slug}>
                <a href={`/a/${a.slug}`}>{a.nome}</a>
              </li>
            ))}
          </ul>
        )}
        {arenas.length === LIMITE_PUBLICO && (
          <p className="escolha-vazia">Mostrando as {LIMITE_PUBLICO} primeiras. Use a busca.</p>
        )}
      </main>
    </>
  );
}

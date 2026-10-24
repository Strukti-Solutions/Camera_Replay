import type { Metadata } from "next";
import { BuscaArenas } from "@/app/componentes/busca-arenas";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { MapaArenas } from "@/app/componentes/mapa-arenas";
import { arenasNoMapa, LIMITE_PUBLICO, listarArenasPublicas } from "@/app/lib/arenas-publicas";
import { poolCompartilhado } from "@/app/lib/pool";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";
import { termoDaBusca } from "./escolha-arena";

// A lista segue o status das arenas (suspensa sai na hora): nada de cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Encontre uma quadra" };

type Props = { searchParams: Promise<{ busca?: string | string[]; ok?: string | string[] }> };

// Porta de entrada pública: o jogador busca a arena e segue para /a/<slug>.
// Só dados de vitrine das arenas ativas aparecem aqui. A busca é um formulário
// GET comum, então funciona sem JavaScript; sugestões e mapa são extras.
export default async function EscolhaDaArena({ searchParams }: Props) {
  const params = await searchParams;
  const busca = termoDaBusca(params.busca);
  // Texto fixo: só o valor exato do redirecionamento liga o aviso, nada é refletido.
  const contaApagada = params.ok === "conta-apagada";
  const sessao = await sessaoJogadorAtual();
  const db = poolCompartilhado();
  const [arenas, pontos] = await Promise.all([listarArenasPublicas(db, busca), arenasNoMapa(db)]);

  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo escolha">
        {contaApagada && (
          <p className="ok-form" role="status">
            Conta apagada.
          </p>
        )}
        <h1>Encontre uma quadra</h1>
        <BuscaArenas busca={busca} />
        <MapaArenas pontos={pontos} />

        {arenas.length === 0 ? (
          <p className="escolha-vazia">Nenhuma arena encontrada.</p>
        ) : (
          <ul className="escolha-lista">
            {arenas.map((a) => (
              <li key={a.slug}>
                <a href={`/a/${a.slug}`}>
                  <span>{a.nome}</span>
                  {a.cidade && <span className="escolha-cidade">{a.cidade}</span>}
                </a>
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

import type { Metadata } from "next";
import { BuscaArenas } from "@/app/componentes/busca-arenas";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { CartaoDaArena } from "@/app/componentes/cartao-arena";
import { MapaArenas, type PontoMapa } from "@/app/componentes/mapa-arenas";
import { cartoesDeArenas, esportesDasArenas, LIMITE_PUBLICO } from "@/app/lib/arenas-publicas";
import { poolCompartilhado } from "@/app/lib/pool";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";
import { hrefHome, lerEsporte, termoDaBusca, textoAPartirDe, textoEncontradas, textoPino } from "./escolha-arena";

// A lista segue o status das arenas (suspensa sai na hora): nada de cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Encontre uma quadra" };

type Props = {
  searchParams: Promise<{ busca?: string | string[]; esporte?: string | string[]; ok?: string | string[] }>;
};

// Porta de entrada pública: o jogador busca a arena e segue para /a/<slug>.
// Só dados de vitrine das arenas ativas aparecem aqui. Busca e esporte são da
// URL (formulário GET e links), então funcionam sem JavaScript; sugestões e
// mapa são extras.
export default async function EscolhaDaArena({ searchParams }: Props) {
  const params = await searchParams;
  const busca = termoDaBusca(params.busca);
  // Texto fixo: só o valor exato do redirecionamento liga o aviso, nada é refletido.
  const contaApagada = params.ok === "conta-apagada";
  const sessao = await sessaoJogadorAtual();
  const db = poolCompartilhado();
  const esportes = await esportesDasArenas(db);
  const esporte = lerEsporte(params.esporte, esportes);
  const arenas = await cartoesDeArenas(db, { busca, esporte: esporte ?? undefined });
  // Sem busca e sem filtro: vitrine ("em destaque", carrossel no celular).
  const vitrine = !busca && !esporte;

  const pontos: PontoMapa[] = arenas.flatMap((a) =>
    a.latitude === null || a.longitude === null
      ? []
      : [
          {
            nome: a.nome,
            slug: a.slug,
            latitude: a.latitude,
            longitude: a.longitude,
            pino: textoPino(a),
            local: a.bairro ?? a.cidade,
            preco: textoAPartirDe(a),
            foto: a.fotos[0] ?? null,
          },
        ],
  );

  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo-largo escolha">
        {contaApagada && (
          <p className="ok-form" role="status">
            Conta apagada.
          </p>
        )}
        <h1>Encontre uma quadra e reserve</h1>
        <BuscaArenas busca={busca} esporte={esporte} />
        {esportes.length > 0 && (
          <nav className="hm-esportes" aria-label="Filtrar por esporte">
            <a href={hrefHome({ busca })} aria-current={esporte === null ? "page" : undefined}>
              Todos
            </a>
            {esportes.map((e) => (
              <a key={e} href={hrefHome({ busca, esporte: e })} aria-current={esporte === e ? "page" : undefined}>
                {e}
              </a>
            ))}
          </nav>
        )}

        <div className="hm-corpo">
          <section className="hm-resultado" aria-labelledby="hm-titulo">
            <h2 id="hm-titulo" className="hm-titulo">
              {vitrine ? "Arenas em destaque" : textoEncontradas(arenas.length)}
            </h2>
            {arenas.length === 0 ? (
              vitrine && <p className="escolha-vazia">Nenhuma arena encontrada.</p>
            ) : (
              <ul className={vitrine ? "hm-lista hm-vitrine" : "hm-lista"}>
                {arenas.map((a) => (
                  <CartaoDaArena key={a.slug} arena={a} />
                ))}
              </ul>
            )}
            {arenas.length === LIMITE_PUBLICO && (
              <p className="escolha-vazia">Mostrando as {LIMITE_PUBLICO} primeiras. Use a busca.</p>
            )}
          </section>
          <MapaArenas pontos={pontos} />
        </div>
      </main>
    </>
  );
}

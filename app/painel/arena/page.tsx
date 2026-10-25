import type { Metadata } from "next";
import { dadosArenaDono } from "@/app/lib/arena-dono";
import { FOTOS_MAX_ARENA, listarFotos } from "@/app/lib/fotos";
import { poolCompartilhado } from "@/app/lib/pool";
import { lerConfigR2 } from "@/app/lib/r2";
import { FotosDoDono } from "../fotos/fotos";
import { exigirSessao } from "../sessao-atual";
import { FormularioArena } from "./formulario";
import { MapinhaArena } from "./mapinha";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Arena",
  robots: { index: false, follow: false },
};

export default async function PaginaArena() {
  const sessao = await exigirSessao();
  const db = poolCompartilhado();
  const [dados, fotos] = await Promise.all([dadosArenaDono(db, sessao.arenaId), listarFotos(db, sessao.arenaId, null)]);
  return (
    <main className="miolo painel">
      <h1>Arena</h1>
      {dados ? (
        <>
          <p>O endereço ajuda os jogadores a encontrar a arena no mapa.</p>
          <FormularioArena nome={dados.nome} endereco={dados.endereco} />
          <section className="secao" aria-labelledby="titulo-mapa">
            <h2 id="titulo-mapa">No mapa</h2>
            {dados.coordenadas ? (
              <>
                <p className="suave">É aqui que a arena aparece para os jogadores.</p>
                <MapinhaArena latitude={dados.coordenadas.latitude} longitude={dados.coordenadas.longitude} nome={dados.nome} />
              </>
            ) : (
              <p className="suave">Salve o endereço para a arena aparecer no mapa.</p>
            )}
          </section>
          <section className="secao" aria-labelledby="titulo-fotos">
            <h2 id="titulo-fotos">Fotos da arena</h2>
            <FotosDoDono
              quadraId={null}
              fotos={fotos}
              max={FOTOS_MAX_ARENA}
              armazenamento={lerConfigR2() !== null}
              rotulo="da arena"
            />
          </section>
        </>
      ) : (
        <p role="alert">Arena não encontrada.</p>
      )}
    </main>
  );
}

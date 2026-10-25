import type { Metadata } from "next";
import { dadosArenaDono } from "@/app/lib/arena-dono";
import { FOTOS_MAX_ARENA, listarFotos } from "@/app/lib/fotos";
import { poolCompartilhado } from "@/app/lib/pool";
import { lerConfigR2 } from "@/app/lib/r2";
import { FotosDoDono } from "../fotos/fotos";
import { exigirSessao } from "../sessao-atual";
import { FormularioArena } from "./formulario";

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

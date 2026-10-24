import type { Metadata } from "next";
import { dadosArenaDono } from "@/app/lib/arena-dono";
import { poolCompartilhado } from "@/app/lib/pool";
import { exigirSessao } from "../sessao-atual";
import { FormularioArena } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Arena",
  robots: { index: false, follow: false },
};

export default async function PaginaArena() {
  const sessao = await exigirSessao();
  const dados = await dadosArenaDono(poolCompartilhado(), sessao.arenaId);
  return (
    <main className="miolo painel">
      <h1>Arena</h1>
      {dados ? (
        <>
          <p>O endereço ajuda os jogadores a encontrar a arena no mapa.</p>
          <FormularioArena nome={dados.nome} endereco={dados.endereco} />
        </>
      ) : (
        <p role="alert">Arena não encontrada.</p>
      )}
    </main>
  );
}

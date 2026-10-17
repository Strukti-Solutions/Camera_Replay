import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { lancesAvulsosDoAluno } from "@/app/lib/acesso-aluno";
import { poolCompartilhado } from "@/app/lib/pool";
import { MarcaDaFaixa } from "@/app/componentes/marca";
import { Galeria, leitorR2 } from "../galeria";
import { arenaEAluno } from "../sessao-aluno";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meus lances avulsos",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ slug: string }> };

// Lances que o dono atribuiu ao aluno, em qualquer quadra da arena, fora das reservas dele.
export default async function MeusLances({ params }: Props) {
  const { slug } = await params;
  const dados = await arenaEAluno(slug);
  if (!dados) notFound();
  if (!dados.aluno) redirect(`/a/${slug}`);

  const { r2, videosDisponiveis } = leitorR2();
  const clipes = await lancesAvulsosDoAluno(poolCompartilhado(), r2, slug, dados.aluno.alunoId);

  return (
    <>
      <header className="faixa">
        <div className="miolo">
          <MarcaDaFaixa />
          <div>
            <p className="faixa-quadra">{dados.arena}</p>
            <h1>Meus lances avulsos</h1>
          </div>
          <a className="botao" href={`/a/${slug}`}>
            Voltar para as reservas
          </a>
        </div>
      </header>
      <main>
        <Galeria clipes={clipes} videosDisponiveis={videosDisponiveis} vazio="Nenhum lance avulso." />
      </main>
    </>
  );
}

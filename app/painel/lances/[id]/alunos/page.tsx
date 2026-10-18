import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listarAlunosParaEscolha } from "@/app/lib/alunos";
import { formatarHorario } from "@/app/lib/formato";
import { clipeParaAtribuir } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { FormularioAlunos } from "@/app/painel/escolha-alunos";
import { atribuirClipeAction } from "@/app/painel/quadras/[id]/actions";
import { exigirSessao } from "@/app/painel/sessao-atual";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atribuir lance",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

// Página própria de "Atribuir a alunos": a lista de alunos da arena é
// carregada uma vez, aqui, e não por lance na tela da quadra. O id da URL só
// vale se o lance for da arena da sessão e assistível (senão, 404).
export default async function PaginaAtribuirLance({ params }: Props) {
  const sessao = await exigirSessao();
  const { id } = await params;
  const db = poolCompartilhado();
  const clipe = await clipeParaAtribuir(db, sessao.arenaId, id);
  if (!clipe) notFound();
  const alunos = await listarAlunosParaEscolha(db, sessao.arenaId);
  const voltar = `/painel/quadras/${clipe.quadraId}`;

  return (
    <main className="miolo painel">
      <p>
        <Link href={voltar}>← Voltar</Link>
      </p>
      <h1>
        Alunos que veem este lance{" "}
        <span className="suave">
          — {formatarHorario(clipe.recebidoEm)} · {clipe.quadraNome}
        </span>
      </h1>
      {alunos.length === 0 ? (
        <p className="painel-vazio">
          Nenhum aluno cadastrado. <Link href="/painel/alunos">Ir para Alunos</Link>
        </p>
      ) : (
        <FormularioAlunos
          acao={atribuirClipeAction}
          campo="clipeId"
          valor={clipe.id}
          alunos={alunos}
          marcados={clipe.alunoIds}
          legenda="Alunos que veem este lance"
          salvar="Salvar atribuição"
        />
      )}
    </main>
  );
}

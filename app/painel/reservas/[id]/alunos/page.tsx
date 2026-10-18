import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listarAlunosParaEscolha } from "@/app/lib/alunos";
import { poolCompartilhado } from "@/app/lib/pool";
import { reservaParaEditar } from "@/app/lib/reservas";
import { textoData, textoReserva } from "@/app/painel/apresentacao";
import { FormularioAlunos } from "@/app/painel/escolha-alunos";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { definirAlunosAction } from "../../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Alunos da reserva",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

// Página própria de "Editar alunos": a lista de alunos da arena é carregada
// uma vez, aqui, e não por reserva na lista. O id da URL só vale se a reserva
// for da arena da sessão (senão, 404 igual a id inexistente).
export default async function PaginaAlunosDaReserva({ params }: Props) {
  const sessao = await exigirSessao();
  const { id } = await params;
  const db = poolCompartilhado();
  const reserva = await reservaParaEditar(db, sessao.arenaId, id);
  if (!reserva) notFound();
  const alunos = await listarAlunosParaEscolha(db, sessao.arenaId);

  return (
    <main className="miolo painel">
      <p>
        <Link href="/painel/reservas">← Voltar</Link>
      </p>
      <h1>
        Alunos da reserva{" "}
        <span className="suave">
          — {textoReserva(reserva.inicio, reserva.fim)} · {reserva.quadraNome} · {textoData(reserva.inicio)}
        </span>
      </h1>
      {alunos.length === 0 ? (
        <p className="painel-vazio">
          Nenhum aluno cadastrado. <Link href="/painel/alunos">Ir para Alunos</Link>
        </p>
      ) : (
        <FormularioAlunos
          acao={definirAlunosAction}
          campo="reservaId"
          valor={reserva.id}
          alunos={alunos}
          marcados={reserva.alunoIds}
          legenda="Alunos da reserva"
          salvar="Salvar alunos"
        />
      )}
    </main>
  );
}

"use client";

import { useActionState } from "react";
import { Avatar } from "@/app/componentes/avatar";

// Escolha de alunos por caixas de marcar, usada na reserva nova, em "Editar
// alunos" da reserva e em "Atribuir a alunos" do lance. Tudo funciona sem
// JavaScript: os ids vão no campo repetido "alunoIds".

export type AlunoEscolha = { id: string; nome: string };

export function CaixasAlunos({
  alunos,
  marcados,
  prefixo,
  legenda = "Alunos",
}: {
  alunos: AlunoEscolha[];
  marcados: string[];
  prefixo: string;
  legenda?: string;
}) {
  return (
    <fieldset className="caixas-alunos">
      <legend>{legenda}</legend>
      <ul>
        {alunos.map((a) => (
          <li key={a.id}>
            {/* O rótulo envolve a caixa: a linha inteira é o alvo de toque. */}
            <label htmlFor={`${prefixo}-${a.id}`}>
              <input
                id={`${prefixo}-${a.id}`}
                type="checkbox"
                name="alunoIds"
                value={a.id}
                defaultChecked={marcados.includes(a.id)}
              />
              <Avatar id={a.id} nome={a.nome} />
              <span>{a.nome}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export type EstadoAlunos = { erro: string | null; ok: boolean };

// Formulário recolhido: o <summary> abre a lista, o botão salva. Depois de
// salvar, o React reinicia o formulário e as caixas voltam a refletir o banco
// (a página é revalidada pela action).
export function EditarAlunos({
  acao: acaoServidor,
  campo,
  valor,
  alunos,
  marcados,
  rotulo,
  legenda,
  salvar,
  salvo,
}: {
  acao: (estado: EstadoAlunos, form: FormData) => Promise<EstadoAlunos>;
  campo: string;
  valor: string;
  alunos: AlunoEscolha[];
  marcados: string[];
  rotulo: string;
  legenda: string;
  salvar: string;
  salvo: string;
}) {
  const [estado, acao, pendente] = useActionState(acaoServidor, { erro: null, ok: false });
  return (
    <div className="confirmar">
      <details>
        <summary className="botao">{rotulo}</summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name={campo} value={valor} />
          <CaixasAlunos alunos={alunos} marcados={marcados} prefixo={`${campo}-${valor}`} legenda={legenda} />
          <button type="submit" className="botao botao-cheio" disabled={pendente}>
            {pendente ? "Salvando…" : salvar}
          </button>
        </form>
      </details>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? salvo : ""}
      </p>
    </div>
  );
}

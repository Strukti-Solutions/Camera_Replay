"use client";

import { useActionState } from "react";
import {
  criarAlunoAction,
  redefinirSenhaAlunoAction,
  type EstadoNovoAluno,
  type EstadoSenhaAluno,
} from "./actions";

// Formulários da página de alunos. Funcionam sem JavaScript; com ele, o
// estado mostra erro e confirmação. O campo de senha nunca é preenchido.

const inicialNovo: EstadoNovoAluno = { erro: null, ok: false, nome: "", email: "" };

export function FormularioNovoAluno() {
  const [estado, acao, pendente] = useActionState(criarAlunoAction, inicialNovo);
  return (
    <form action={acao} className="formulario" aria-labelledby="titulo-novo-aluno">
      <h2 id="titulo-novo-aluno">Novo aluno</h2>
      <div className="campo">
        <label htmlFor="aluno-nome">Nome</label>
        <input id="aluno-nome" name="nome" type="text" autoComplete="off" maxLength={80} defaultValue={estado.nome} required />
      </div>
      <div className="campo">
        <label htmlFor="aluno-email">E-mail</label>
        <input
          id="aluno-email"
          name="email"
          type="email"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          defaultValue={estado.email}
          required
        />
      </div>
      <div className="campo">
        <label htmlFor="aluno-senha">Senha</label>
        <input
          id="aluno-senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          aria-describedby="aluno-senha-dica"
          required
        />
        <p id="aluno-senha-dica" className="suave">
          Mínimo de 8 caracteres.
        </p>
      </div>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? "Aluno cadastrado." : ""}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Cadastrando…" : "Cadastrar aluno"}
      </button>
    </form>
  );
}

const inicialSenha: EstadoSenhaAluno = { erro: null, ok: false };

// Recolhido num <details>, como a confirmação das ações destrutivas.
export function RedefinirSenha({ alunoId }: { alunoId: string }) {
  const [estado, acao, pendente] = useActionState(redefinirSenhaAlunoAction, inicialSenha);
  const id = `senha-${alunoId}`;
  return (
    <div className="confirmar">
      <details>
        <summary className="botao">Redefinir senha</summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name="alunoId" value={alunoId} />
          <div className="campo">
            <label htmlFor={id}>Nova senha</label>
            <input
              id={id}
              name="senha"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
              aria-describedby={`${id}-dica`}
              required
            />
            <p id={`${id}-dica`} className="suave">
              Mínimo de 8 caracteres. O aluno sai de todos os aparelhos.
            </p>
          </div>
          <button type="submit" className="botao botao-cheio" disabled={pendente}>
            {pendente ? "Salvando…" : "Salvar senha"}
          </button>
        </form>
      </details>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? "Senha redefinida." : ""}
      </p>
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { entrarAlunoAction, type EstadoEntrarAluno } from "./actions";

const inicial: EstadoEntrarAluno = { erro: null, email: "" };

export function FormularioEntrarAluno({ slug, reserva }: { slug: string; reserva: string | null }) {
  const [estado, acao, pendente] = useActionState(entrarAlunoAction, inicial);
  return (
    <form action={acao} className="formulario">
      <input type="hidden" name="slug" value={slug} />
      {reserva && <input type="hidden" name="r" value={reserva} />}
      <div className="campo">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" defaultValue={estado.email} required />
      </div>
      <div className="campo">
        <label htmlFor="senha">Senha</label>
        <input id="senha" name="senha" type="password" autoComplete="current-password" required />
      </div>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

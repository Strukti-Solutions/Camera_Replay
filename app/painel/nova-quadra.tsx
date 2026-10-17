"use client";

import { useActionState } from "react";
import { criarQuadraAction, type EstadoNovaQuadra } from "./actions";

const inicial: EstadoNovaQuadra = { erro: null, nome: "" };

export function FormularioNovaQuadra() {
  const [estado, acao, pendente] = useActionState(criarQuadraAction, inicial);
  return (
    <form action={acao} className="formulario" aria-labelledby="titulo-nova-quadra">
      <h2 id="titulo-nova-quadra">Nova quadra</h2>
      <div className="campo">
        <label htmlFor="nova-quadra-nome">Nome</label>
        <input id="nova-quadra-nome" name="nome" type="text" maxLength={60} defaultValue={estado.nome} required />
      </div>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Criando…" : "Criar quadra"}
      </button>
    </form>
  );
}

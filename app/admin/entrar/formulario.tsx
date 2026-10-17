"use client";

import { useActionState } from "react";
import { entrarAdminAction, type EstadoEntrarAdmin } from "./actions";

const inicial: EstadoEntrarAdmin = { erro: null, email: "" };

export function FormularioEntrarAdmin() {
  const [estado, acao, pendente] = useActionState(entrarAdminAction, inicial);
  return (
    <form action={acao} className="formulario">
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

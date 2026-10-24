"use client";

import { useActionState } from "react";
import { esqueciAction, type EstadoEsqueci } from "./actions";

const inicial: EstadoEsqueci = { ok: null, email: "" };

export function FormularioEsqueci() {
  const [estado, acao, pendente] = useActionState(esqueciAction, inicial);
  return (
    <form action={acao} className="formulario">
      <div className="campo">
        <label htmlFor="email">E-mail</label>
        <input
          id="email" name="email" type="email" autoComplete="email" maxLength={254}
          defaultValue={estado.email} required
        />
      </div>
      <p className="ok-form" role="status">{estado.ok}</p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Enviando…" : "Enviar link"}
      </button>
    </form>
  );
}

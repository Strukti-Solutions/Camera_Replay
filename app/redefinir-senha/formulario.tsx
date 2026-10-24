"use client";

import Link from "next/link";
import { useActionState } from "react";
import { redefinirAction, type EstadoRedefinir } from "./actions";

const inicial: EstadoRedefinir = { erro: null, ok: null, link: false };

export function FormularioRedefinir({ token }: { token: string }) {
  const [estado, acao, pendente] = useActionState(redefinirAction, inicial);
  return (
    <>
      <p className="erro-form" role="alert">{estado.erro}</p>
      <p className="ok-form" role="status">{estado.ok}</p>
      {estado.ok ? (
        <p className="entrar-links"><Link href="/entrar">Entrar</Link></p>
      ) : estado.link ? (
        <p className="entrar-links"><Link href="/esqueci-a-senha">Pedir um novo link</Link></p>
      ) : (
        <form action={acao} className="formulario">
          <input type="hidden" name="t" value={token} />
          <div className="campo">
            <label htmlFor="nova">Nova senha</label>
            <input id="nova" name="nova" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <div className="campo">
            <label htmlFor="confirmar">Repita a nova senha</label>
            <input id="confirmar" name="confirmar" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <button type="submit" className="botao botao-cheio" disabled={pendente}>
            {pendente ? "Salvando…" : "Salvar nova senha"}
          </button>
        </form>
      )}
    </>
  );
}

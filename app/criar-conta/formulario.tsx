"use client";

import Link from "next/link";
import { useActionState } from "react";
import { criarContaAction, type EstadoCriarConta } from "./actions";

const inicial: EstadoCriarConta = { erro: null, nome: "", email: "" };

export function FormularioCriarConta({ voltar }: { voltar: string | null }) {
  const [estado, acao, pendente] = useActionState(criarContaAction, inicial);
  return (
    <form action={acao} className="formulario">
      {voltar ? <input type="hidden" name="voltar" value={voltar} /> : null}
      <div className="campo">
        <label htmlFor="nome">Nome</label>
        <input id="nome" name="nome" type="text" autoComplete="name" maxLength={80} defaultValue={estado.nome} required />
      </div>
      <div className="campo">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" defaultValue={estado.email} required />
      </div>
      <div className="campo">
        <label htmlFor="senha">Senha (mínimo 8 caracteres)</label>
        <input id="senha" name="senha" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="campo-caixa">
        <input id="termos" name="termos" type="checkbox" required />
        <label htmlFor="termos">
          Li e aceito os <Link href="/termos" target="_blank">termos de uso e a política de privacidade</Link>.
        </label>
      </div>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Criando…" : "Criar conta"}
      </button>
    </form>
  );
}

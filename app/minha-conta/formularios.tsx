"use client";

import { useActionState } from "react";
import {
  apagarContaAction, mudarNomeAction, trocarSenhaAction, type EstadoConta,
} from "./actions";

const inicial: EstadoConta = { erro: null, ok: null };

function Mensagens({ estado }: { estado: EstadoConta }) {
  return (
    <>
      <p className="erro-form" role="alert">{estado.erro}</p>
      <p className="ok-form" role="status">{estado.ok}</p>
    </>
  );
}

export function FormularioNome({ nome }: { nome: string }) {
  const [estado, acao, pendente] = useActionState(mudarNomeAction, inicial);
  return (
    <form action={acao} className="formulario">
      <div className="campo">
        <label htmlFor="nome">Nome</label>
        <input id="nome" name="nome" type="text" autoComplete="name" maxLength={80} defaultValue={nome} required />
      </div>
      <Mensagens estado={estado} />
      <button type="submit" className="botao botao-cheio" disabled={pendente}>Salvar nome</button>
    </form>
  );
}

export function FormularioSenha() {
  const [estado, acao, pendente] = useActionState(trocarSenhaAction, inicial);
  return (
    <form action={acao} className="formulario">
      <div className="campo">
        <label htmlFor="atual">Senha atual</label>
        <input id="atual" name="atual" type="password" autoComplete="current-password" required />
      </div>
      <div className="campo">
        <label htmlFor="nova">Nova senha (mínimo 8 caracteres)</label>
        <input id="nova" name="nova" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <Mensagens estado={estado} />
      <button type="submit" className="botao botao-cheio" disabled={pendente}>Trocar senha</button>
    </form>
  );
}

export function FormularioApagar() {
  const [estado, acao, pendente] = useActionState(apagarContaAction, inicial);
  return (
    <form action={acao} className="formulario">
      <div className="campo">
        <label htmlFor="senha-apagar">Senha</label>
        <input id="senha-apagar" name="senha" type="password" autoComplete="current-password" required />
      </div>
      <div className="campo-caixa">
        <input id="entendo" name="entendo" type="checkbox" required />
        <label htmlFor="entendo">Entendo que a conta e o histórico serão apagados</label>
      </div>
      <Mensagens estado={estado} />
      <button type="submit" className="botao botao-perigo-cheio" disabled={pendente}>Apagar minha conta</button>
    </form>
  );
}

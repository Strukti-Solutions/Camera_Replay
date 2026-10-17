"use client";

import { useActionState } from "react";
import {
  criarArenaAction,
  criarSuperAdminAction,
  type EstadoNovaArena,
  type EstadoNovoSuperAdmin,
  type EstadoStatusArena,
} from "./actions";

// Formulários do painel do super admin. Funcionam sem JavaScript; com ele, o
// estado mostra erro e confirmação. O campo de senha nunca é preenchido.

const inicialArena: EstadoNovaArena = { erro: null, ok: false, arena: "", email: "" };

export function FormularioNovaArena() {
  const [estado, acao, pendente] = useActionState(criarArenaAction, inicialArena);
  return (
    <form action={acao} className="formulario" aria-labelledby="titulo-nova-arena">
      <h2 id="titulo-nova-arena">Nova arena</h2>
      <div className="campo">
        <label htmlFor="arena-nome">Nome da arena</label>
        <input
          id="arena-nome"
          name="arena"
          type="text"
          autoComplete="off"
          maxLength={80}
          defaultValue={estado.arena}
          required
        />
      </div>
      <div className="campo">
        <label htmlFor="arena-email">E-mail do dono</label>
        <input
          id="arena-email"
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
        <label htmlFor="arena-senha">Senha do dono</label>
        <input
          id="arena-senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={200}
          aria-describedby="arena-senha-dica"
          required
        />
        <p id="arena-senha-dica" className="suave">
          Mínimo de 10 caracteres.
        </p>
      </div>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? "Arena criada." : ""}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Criando…" : "Criar arena"}
      </button>
    </form>
  );
}

const inicialAdmin: EstadoNovoSuperAdmin = { erro: null, ok: false, email: "" };

export function FormularioNovoSuperAdmin() {
  const [estado, acao, pendente] = useActionState(criarSuperAdminAction, inicialAdmin);
  return (
    <form action={acao} className="formulario" aria-labelledby="titulo-novo-admin">
      <h2 id="titulo-novo-admin">Novo super admin</h2>
      <div className="campo">
        <label htmlFor="admin-email">E-mail</label>
        <input
          id="admin-email"
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
        <label htmlFor="admin-senha">Senha</label>
        <input
          id="admin-senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={200}
          aria-describedby="admin-senha-dica"
          required
        />
        <p id="admin-senha-dica" className="suave">
          Mínimo de 12 caracteres.
        </p>
      </div>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? "Super admin criado." : ""}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Criando…" : "Criar super admin"}
      </button>
    </form>
  );
}

// Suspender ou reativar em dois cliques, como as ações destrutivas do painel
// do dono: o primeiro abre o <details>, o segundo confirma. Sem JavaScript também.
export function ConfirmarStatus({
  acao: acaoServidor,
  arenaId,
  rotulo,
  pergunta,
  confirmar,
  perigo,
}: {
  acao: (estado: EstadoStatusArena, form: FormData) => Promise<EstadoStatusArena>;
  arenaId: string;
  rotulo: string;
  pergunta: string;
  confirmar: string;
  perigo: boolean;
}) {
  const [estado, acao, pendente] = useActionState(acaoServidor, { erro: null });
  return (
    <div className="confirmar">
      <details>
        <summary className={perigo ? "botao botao-perigo" : "botao"}>{rotulo}</summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name="arenaId" value={arenaId} />
          <p>{pergunta}</p>
          <button
            type="submit"
            className={perigo ? "botao botao-perigo-cheio" : "botao botao-cheio"}
            disabled={pendente}
          >
            {pendente ? "Aguarde…" : confirmar}
          </button>
        </form>
      </details>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
    </div>
  );
}

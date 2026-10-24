"use client";

import { useActionState } from "react";
import {
  salvarQuadraAction,
  type EstadoQuadra,
} from "./actions";

const inicialQuadra: EstadoQuadra = { erro: null, ok: false };

export function FormularioQuadra({ quadraId, nome, esporte }: { quadraId: string; nome: string; esporte: string }) {
  const [estado, acao, pendente] = useActionState(salvarQuadraAction, inicialQuadra);
  return (
    <form action={acao} className="formulario">
      <input type="hidden" name="quadraId" value={quadraId} />
      <div className="campo">
        <label htmlFor="quadra-nome">Nome da quadra</label>
        <input id="quadra-nome" name="nome" type="text" maxLength={60} defaultValue={nome} required />
      </div>
      <div className="campo">
        <label htmlFor="quadra-esporte">Esporte (opcional)</label>
        <input id="quadra-esporte" name="esporte" type="text" maxLength={40} defaultValue={esporte}
          placeholder="Ex.: Beach tennis" />
      </div>
      <p className="erro-form" role="alert">{estado.erro}</p>
      <p className="ok-form" role="status">{estado.ok ? "Quadra atualizada." : ""}</p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Salvando…" : "Salvar quadra"}
      </button>
    </form>
  );
}

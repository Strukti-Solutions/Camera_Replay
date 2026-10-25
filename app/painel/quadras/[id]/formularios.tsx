"use client";

import { useActionState } from "react";
import type { EstadoConfirmar } from "./actions";

// Ação destrutiva em dois cliques: o primeiro abre o <details>, o segundo
// confirma. Funciona sem JavaScript. `extras` são campos ocultos a mais (o admin
// manda o arenaId da arena que está configurando).
export function Confirmar({
  acao: acaoServidor,
  campo,
  valor,
  extras,
  rotulo,
  rotuloAcessivel,
  pergunta,
  confirmar,
}: {
  acao: (estado: EstadoConfirmar, form: FormData) => Promise<EstadoConfirmar>;
  campo: string;
  valor: string;
  extras?: Record<string, string>;
  rotulo: string;
  rotuloAcessivel?: string; // quando há vários botões iguais na tela ("Apagar foto 2")
  pergunta: string;
  confirmar: string;
}) {
  const [estado, acao, pendente] = useActionState(acaoServidor, { erro: null });
  return (
    <div className="confirmar">
      <details>
        <summary className="botao botao-perigo" aria-label={rotuloAcessivel}>
          {rotulo}
        </summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name={campo} value={valor} />
          {Object.entries(extras ?? {}).map(([nome, v]) => (
            <input key={nome} type="hidden" name={nome} value={v} />
          ))}
          <p>{pergunta}</p>
          <button type="submit" className="botao botao-perigo-cheio" disabled={pendente}>
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

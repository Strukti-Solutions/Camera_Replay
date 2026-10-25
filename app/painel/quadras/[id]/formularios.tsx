"use client";

import { useActionState, useRef } from "react";
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
  const caixa = useRef<HTMLDetailsElement>(null);
  return (
    <div className="confirmar">
      <details ref={caixa}>
        <summary className="botao botao-perigo" aria-label={rotuloAcessivel}>
          {rotulo}
        </summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name={campo} value={valor} />
          {Object.entries(extras ?? {}).map(([nome, v]) => (
            <input key={nome} type="hidden" name={nome} value={v} />
          ))}
          <p>{pergunta}</p>
          <div className="confirmar-botoes">
            <button type="submit" className="botao botao-perigo-cheio" disabled={pendente}>
              {pendente ? "Aguarde…" : confirmar}
            </button>
            {/* Sem JavaScript, fecha clicando de novo no primeiro botão. */}
            <button
              type="button"
              className="botao"
              onClick={() => {
                if (caixa.current) caixa.current.open = false;
              }}
            >
              Fechar
            </button>
          </div>
        </form>
      </details>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
    </div>
  );
}

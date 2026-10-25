"use client";

import { useRef } from "react";

// "Cancelar" cinza quando o prazo já passou: em vez de sumir, explica o porquê.
// É um <details>, então abre e fecha mesmo sem JavaScript.
export function CancelarIndisponivel() {
  const caixa = useRef<HTMLDetailsElement>(null);
  return (
    <div className="confirmar">
      <details ref={caixa}>
        <summary className="botao botao-indisponivel" aria-label="Cancelar (indisponível)">
          Cancelar
        </summary>
        <div className="confirmar-caixa" role="status">
          <p>Não dá mais para cancelar: o cancelamento vai até 24 h antes do horário.</p>
          <div className="confirmar-botoes">
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
        </div>
      </details>
    </div>
  );
}

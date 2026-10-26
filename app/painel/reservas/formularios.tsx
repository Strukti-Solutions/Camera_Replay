"use client";

import { useActionState, useRef, type RefObject } from "react";
import { bloquearAction, cancelarReservaDonoAction } from "./actions";

// Botão "Fechar" da confirmação: sem JavaScript, fecha clicando de novo no primeiro botão.
function Fechar({ caixa }: { caixa: RefObject<HTMLDetailsElement | null> }) {
  return (
    <button type="button" className="botao" onClick={() => caixa.current?.removeAttribute("open")}>
      Fechar
    </button>
  );
}

// Cancelar em dois cliques (o <details> abre a confirmação), com motivo
// opcional. Funciona sem JavaScript.
export function CancelarReservaDono({
  reservaId, descricao, pergunta, volta,
}: { reservaId: string; descricao: string; pergunta: string; volta: string }) {
  const [estado, acao, pendente] = useActionState(cancelarReservaDonoAction, { erro: null });
  const caixa = useRef<HTMLDetailsElement>(null);
  const idMotivo = `motivo-${reservaId}`;
  return (
    <div className="confirmar">
      <details ref={caixa}>
        <summary className="botao botao-perigo" aria-label={`Cancelar a reserva ${descricao}`}>
          Cancelar
        </summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name="reservaId" value={reservaId} />
          <input type="hidden" name="volta" value={volta} />
          <p>{pergunta}</p>
          <div className="campo">
            <label htmlFor={idMotivo}>Motivo (opcional)</label>
            <input id={idMotivo} name="motivo" type="text" maxLength={120} placeholder="Ex.: Quadra em manutenção" />
          </div>
          <div className="confirmar-botoes">
            <button type="submit" className="botao botao-perigo-cheio" disabled={pendente}>
              {pendente ? "Aguarde…" : "Cancelar"}
            </button>
            <Fechar caixa={caixa} />
          </div>
        </form>
      </details>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
    </div>
  );
}

// Bloquear um horário livre, ou todos os livres do dia na quadra ("Bloquear o
// dia todo"), com o mesmo motivo.
export function Bloquear({
  quadraId,
  dia,
  horarios,
  rotulo,
  descricao,
  volta,
}: {
  quadraId: string;
  dia: string;
  horarios: { inicio: number; fim: number }[];
  rotulo: string;
  descricao: string;
  volta: string;
}) {
  const [estado, acao, pendente] = useActionState(bloquearAction, { erro: null });
  const caixa = useRef<HTMLDetailsElement>(null);
  const idMotivo = `motivo-${quadraId}-${horarios.map((h) => h.inicio).join("-")}`;
  return (
    <div className="confirmar">
      <details ref={caixa}>
        <summary className="botao" aria-label={`${rotulo} ${descricao}`}>
          {rotulo}
        </summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name="quadraId" value={quadraId} />
          <input type="hidden" name="dia" value={dia} />
          <input type="hidden" name="volta" value={volta} />
          {horarios.map((h) => (
            <input key={h.inicio} type="hidden" name="h" value={`${h.inicio}-${h.fim}`} />
          ))}
          <p>Bloquear {descricao}? Ninguém vai conseguir reservar.</p>
          <div className="campo">
            <label htmlFor={idMotivo}>Motivo</label>
            <input
              id={idMotivo}
              name="motivo"
              type="text"
              maxLength={60} // MOTIVO_BLOQUEIO_MAX em app/lib/reservas.ts
              required
              placeholder="Ex.: Reserva por telefone — João"
            />
          </div>
          <div className="confirmar-botoes">
            <button type="submit" className="botao botao-cheio" disabled={pendente}>
              {pendente ? "Aguarde…" : "Bloquear"}
            </button>
            <Fechar caixa={caixa} />
          </div>
        </form>
      </details>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
    </div>
  );
}

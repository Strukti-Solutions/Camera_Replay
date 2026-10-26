"use client";

import { useActionState } from "react";
import { confirmarReservaAction, type EstadoReservar } from "./actions";

const inicial: EstadoReservar = { erro: null };

// A escolha vai em campos escondidos; a action revalida tudo antes de gravar.
export function FormularioReservar({
  quadra,
  dia,
  inicio,
  qtd,
  online,
}: {
  quadra: string;
  dia: string;
  inicio: number;
  qtd: number;
  online: boolean;
}) {
  const [estado, acao, pendente] = useActionState(confirmarReservaAction, inicial);
  return (
    <form action={acao} className="formulario">
      <input type="hidden" name="quadra" value={quadra} />
      <input type="hidden" name="dia" value={dia} />
      <input type="hidden" name="inicio" value={inicio} />
      <input type="hidden" name="qtd" value={qtd} />
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? (online ? "Abrindo o pagamento…" : "Confirmando…") : online ? "Confirmar e pagar" : "Confirmar reserva"}
      </button>
    </form>
  );
}

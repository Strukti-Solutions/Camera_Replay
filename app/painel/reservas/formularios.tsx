"use client";

import { useActionState } from "react";
import { textoHora } from "@/app/lib/precos";
import { bloquearHorarioAction, cancelarReservaDonoAction, type EstadoBloqueio } from "./actions";

// Cancelar em dois cliques (o <details> abre a confirmação), com motivo
// opcional. Funciona sem JavaScript.
export function CancelarReservaDono({ reservaId, descricao }: { reservaId: string; descricao: string }) {
  const [estado, acao, pendente] = useActionState(cancelarReservaDonoAction, { erro: null });
  const idMotivo = `motivo-${reservaId}`;
  return (
    <div className="confirmar">
      <details>
        <summary className="botao botao-perigo">Cancelar</summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name="reservaId" value={reservaId} />
          <p>Cancelar a reserva {descricao}? O horário volta a ficar livre.</p>
          <div className="campo">
            <label htmlFor={idMotivo}>Motivo (opcional)</label>
            <input id={idMotivo} name="motivo" type="text" maxLength={120} placeholder="Ex.: Quadra em manutenção" />
          </div>
          <button type="submit" className="botao botao-perigo-cheio" disabled={pendente}>
            {pendente ? "Aguarde…" : "Sim, cancelar reserva"}
          </button>
        </form>
      </details>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
    </div>
  );
}

const INICIOS = Array.from({ length: 24 }, (_, h) => h); // 0–23
const FINS = Array.from({ length: 24 }, (_, h) => h + 1); // 1–24

const inicial: EstadoBloqueio = { erro: null, versao: 0, valores: { quadraId: "", dia: "", inicio: "", fim: "", motivo: "" } };

export function FormularioBloqueio({
  quadras,
  dias,
}: {
  quadras: { id: string; nome: string }[];
  dias: { valor: string; rotulo: string }[];
}) {
  const [estado, acao, pendente] = useActionState(bloquearHorarioAction, inicial);
  const v = estado.valores;
  return (
    // A key remonta o formulário a cada resposta, com os valores devolvidos.
    <form key={estado.versao} action={acao} className="formulario">
      <div className="campo">
        <label htmlFor="bloqueio-quadra">Quadra</label>
        <select id="bloqueio-quadra" name="quadraId" defaultValue={v.quadraId} required>
          <option value="" disabled>Escolha</option>
          {quadras.map((q) => <option key={q.id} value={q.id}>{q.nome}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="bloqueio-dia">Dia</label>
        <select id="bloqueio-dia" name="dia" defaultValue={v.dia} required>
          <option value="" disabled>Escolha</option>
          {dias.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="bloqueio-inicio">Início</label>
        <select id="bloqueio-inicio" name="inicio" defaultValue={v.inicio} required>
          <option value="" disabled>Escolha</option>
          {INICIOS.map((h) => <option key={h} value={h}>{textoHora(h)}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="bloqueio-fim">Fim</label>
        <select id="bloqueio-fim" name="fim" defaultValue={v.fim} required>
          <option value="" disabled>Escolha</option>
          {FINS.map((h) => <option key={h} value={h}>{textoHora(h)}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="bloqueio-motivo">Motivo</label>
        <input id="bloqueio-motivo" name="motivo" type="text" maxLength={60} defaultValue={v.motivo}
          placeholder="Ex.: Reserva por telefone — João" required />
      </div>
      <p className="erro-form" role="alert">{estado.erro}</p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Bloqueando…" : "Bloquear horário"}
      </button>
    </form>
  );
}

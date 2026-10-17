"use client";

import { Fragment, useActionState } from "react";
import { CaixasAlunos, type AlunoEscolha } from "@/app/painel/escolha-alunos";
import { criarReservaAction, type EstadoNovaReserva } from "./actions";

// Formulário "Nova reserva". Data e horários são digitados no horário de São
// Paulo; a conversão para instante absoluto é feita no servidor.

const inicial: EstadoNovaReserva = {
  erro: null,
  ok: false,
  versao: 0,
  quadraId: "",
  data: "",
  inicio: "",
  fim: "",
  alunoIds: [],
};

export function FormularioNovaReserva({
  quadras,
  alunos,
}: {
  quadras: { id: string; nome: string }[];
  alunos: AlunoEscolha[];
}) {
  const [estado, acao, pendente] = useActionState(criarReservaAction, inicial);
  return (
    <form action={acao} className="formulario" aria-labelledby="titulo-nova-reserva">
      <h2 id="titulo-nova-reserva">Nova reserva</h2>
      {/* key: os campos remontam com os valores devolvidos pela action (o
          <select> e as caixas só leem o valor inicial na montagem). As
          mensagens ficam fora, para a região viva não ser recriada. */}
      <Fragment key={estado.versao}>
        <div className="campo">
          <label htmlFor="reserva-quadra">Quadra</label>
          <select id="reserva-quadra" name="quadraId" defaultValue={estado.quadraId || quadras[0]?.id} required>
            {quadras.map((q) => (
              <option key={q.id} value={q.id}>
                {q.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="reserva-data">Data</label>
          <input id="reserva-data" name="data" type="date" defaultValue={estado.data} required />
        </div>
        <div className="campos-lado">
          <div className="campo">
            <label htmlFor="reserva-inicio">Início</label>
            <input id="reserva-inicio" name="inicio" type="time" defaultValue={estado.inicio} aria-describedby="reserva-fuso" required />
          </div>
          <div className="campo">
            <label htmlFor="reserva-fim">Fim</label>
            <input id="reserva-fim" name="fim" type="time" defaultValue={estado.fim} aria-describedby="reserva-fuso" required />
          </div>
        </div>
        <p id="reserva-fuso" className="suave">Horário de São Paulo.</p>
        <CaixasAlunos alunos={alunos} marcados={estado.alunoIds} prefixo="reserva-aluno" />
      </Fragment>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? "Reserva criada." : ""}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Criando…" : "Criar reserva"}
      </button>
    </form>
  );
}

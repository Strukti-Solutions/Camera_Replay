"use client";

import { useActionState } from "react";
import { NOMES_DIAS, textoHora } from "@/app/lib/precos";
import {
  adicionarFaixaAction,
  removerFaixaAction,
  salvarQuadraAction,
  type EstadoConfirmar,
  type EstadoFaixa,
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

const INICIOS = Array.from({ length: 24 }, (_, h) => h); // 0–23
const FINS = Array.from({ length: 24 }, (_, h) => h + 1); // 1–24
// Domingo por último: a semana de quadra começa na segunda.
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

const inicialFaixa: EstadoFaixa = { erro: null, ok: false, versao: 0, valores: { dias: [], inicio: "", fim: "", preco: "" } };

export function FormularioFaixa({ quadraId }: { quadraId: string }) {
  const [estado, acao, pendente] = useActionState(adicionarFaixaAction, inicialFaixa);
  const v = estado.valores;
  return (
    // A key remonta o formulário a cada resposta, com os valores devolvidos.
    <form key={estado.versao} action={acao} className="formulario">
      <input type="hidden" name="quadraId" value={quadraId} />
      <fieldset className="dias">
        <legend>Dias</legend>
        {ORDEM_DIAS.map((d) => (
          <label key={d} className="dia">
            <input type="checkbox" name="dia" value={d} defaultChecked={v.dias.includes(d)} />
            {NOMES_DIAS[d]}
          </label>
        ))}
      </fieldset>
      <div className="campo">
        <label htmlFor="faixa-inicio">Início</label>
        <select id="faixa-inicio" name="inicio" defaultValue={v.inicio} required>
          <option value="" disabled>Escolha</option>
          {INICIOS.map((h) => <option key={h} value={h}>{textoHora(h)}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="faixa-fim">Fim</label>
        <select id="faixa-fim" name="fim" defaultValue={v.fim} required>
          <option value="" disabled>Escolha</option>
          {FINS.map((h) => <option key={h} value={h}>{textoHora(h)}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="faixa-preco">Preço por hora (R$)</label>
        <input id="faixa-preco" name="preco" type="text" inputMode="decimal" maxLength={15} defaultValue={v.preco}
          placeholder="Ex.: 80,00" required />
      </div>
      <p className="erro-form" role="alert">{estado.erro}</p>
      <p className="ok-form" role="status">{estado.ok ? "Faixa adicionada." : ""}</p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Adicionando…" : "Adicionar faixa"}
      </button>
    </form>
  );
}

const inicialRemover: EstadoConfirmar = { erro: null };

export function RemoverFaixa({ faixaId, descricao }: { faixaId: string; descricao: string }) {
  const [estado, acao, pendente] = useActionState(removerFaixaAction, inicialRemover);
  return (
    <form action={acao} className="remover-faixa">
      <input type="hidden" name="faixaId" value={faixaId} />
      <button type="submit" className="botao botao-perigo" disabled={pendente} aria-label={`Remover ${descricao}`}>
        {pendente ? "Aguarde…" : "Remover"}
      </button>
      <p className="erro-form" role="alert">{estado.erro}</p>
    </form>
  );
}

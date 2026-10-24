"use client";

import { useActionState } from "react";
import { UFS, type EnderecoArena } from "@/app/lib/arena-dono";
import { salvarArenaAction, type EstadoArena } from "./actions";

const inicial: EstadoArena = { erro: null, ok: null };

export function FormularioArena({ nome, endereco }: { nome: string; endereco: EnderecoArena | null }) {
  const [estado, acao, pendente] = useActionState(salvarArenaAction, inicial);
  const e = endereco;
  return (
    <form action={acao} className="formulario">
      <div className="campo">
        <label htmlFor="nome">Nome da arena</label>
        <input id="nome" name="nome" type="text" maxLength={80} defaultValue={nome} required />
      </div>
      <div className="campo">
        <label htmlFor="rua">Rua</label>
        <input id="rua" name="rua" type="text" autoComplete="address-line1" maxLength={120} defaultValue={e?.rua} required />
      </div>
      <div className="campo">
        <label htmlFor="numero">Número</label>
        <input id="numero" name="numero" type="text" maxLength={20} defaultValue={e?.numero} required />
      </div>
      <div className="campo">
        <label htmlFor="bairro">Bairro (opcional)</label>
        <input id="bairro" name="bairro" type="text" maxLength={80} defaultValue={e?.bairro} />
      </div>
      <div className="campo">
        <label htmlFor="cidade">Cidade</label>
        <input id="cidade" name="cidade" type="text" autoComplete="address-level2" maxLength={80} defaultValue={e?.cidade} required />
      </div>
      <div className="campo">
        <label htmlFor="uf">Estado (UF)</label>
        <select id="uf" name="uf" defaultValue={e?.uf ?? ""} required>
          <option value="" disabled>Escolha</option>
          {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="cep">CEP</label>
        <input id="cep" name="cep" type="text" inputMode="numeric" autoComplete="postal-code" maxLength={9}
          pattern="\d{5}-?\d{3}" defaultValue={e?.cep} required />
      </div>
      <p className="erro-form" role="alert">{estado.erro}</p>
      <p className="ok-form" role="status">{estado.ok}</p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>Salvar arena</button>
    </form>
  );
}

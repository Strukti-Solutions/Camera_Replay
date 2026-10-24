"use client";

import { useActionState } from "react";
import {
  atualizarCredenciaisAction,
  cadastrarCameraAction,
  criarBotaoAction,
  criarQuadraAction,
  definirTaxaAction,
  renomearQuadraAction,
  type EstadoCredenciais,
  type EstadoNovoBotao,
  type EstadoRenomear,
  type EstadoTaxa,
} from "./actions";

// Formulários da página da arena no admin. Todos funcionam sem JavaScript (a action
// roda no servidor); com JavaScript, o estado mostra erro e resultado. Cada um leva
// o arenaId num campo oculto, e a action o confere de novo.

export function FormularioTaxa({ arenaId, taxa }: { arenaId: string; taxa: string }) {
  const inicial: EstadoTaxa = { erro: null, ok: false, valor: taxa };
  const [estado, acao, pendente] = useActionState(definirTaxaAction, inicial);
  return (
    <form action={acao} className="formulario" aria-labelledby="titulo-taxa">
      <h2 id="titulo-taxa">Taxa da Strukti</h2>
      <input type="hidden" name="arenaId" value={arenaId} />
      <div className="campo">
        <label htmlFor="taxa-valor">Taxa (%)</label>
        <input
          id="taxa-valor"
          name="taxa"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={6}
          defaultValue={estado.valor}
          aria-describedby="taxa-dica"
          required
        />
        <p id="taxa-dica" className="suave">
          De 0 a 30, como 10 ou 7,5.
        </p>
      </div>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? "Taxa atualizada." : ""}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Salvando…" : "Salvar taxa"}
      </button>
    </form>
  );
}

export function FormularioNovaQuadra({ arenaId }: { arenaId: string }) {
  const [estado, acao, pendente] = useActionState(criarQuadraAction, { erro: null, nome: "" });
  return (
    <form action={acao} className="formulario" aria-labelledby="titulo-nova-quadra">
      <h2 id="titulo-nova-quadra">Nova quadra</h2>
      <input type="hidden" name="arenaId" value={arenaId} />
      <div className="campo">
        <label htmlFor="nova-quadra-nome">Nome</label>
        <input id="nova-quadra-nome" name="nome" type="text" maxLength={60} defaultValue={estado.nome} required />
      </div>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Criando…" : "Criar quadra"}
      </button>
    </form>
  );
}

const inicialRenomear: EstadoRenomear = { erro: null, ok: false };

export function FormularioRenomear({ arenaId, quadraId, nome }: { arenaId: string; quadraId: string; nome: string }) {
  const [estado, acao, pendente] = useActionState(renomearQuadraAction, inicialRenomear);
  const id = `renomear-${quadraId}`;
  return (
    <form action={acao} className="formulario">
      <input type="hidden" name="arenaId" value={arenaId} />
      <input type="hidden" name="quadraId" value={quadraId} />
      <div className="campo">
        <label htmlFor={id}>Nome da quadra</label>
        <input id={id} name="nome" type="text" maxLength={60} defaultValue={nome} required />
      </div>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? "Nome atualizado." : ""}
      </p>
      <button type="submit" className="botao" disabled={pendente}>
        {pendente ? "Salvando…" : "Renomear"}
      </button>
    </form>
  );
}

// Campos de credencial: nunca preenchidos (nem com o valor atual nem depois
// de um erro). O navegador não deve sugerir nem guardar.
function CamposCredenciais({ prefixo }: { prefixo: string }) {
  return (
    <>
      <div className="campo">
        <label htmlFor={`${prefixo}-authcode`}>AuthCode</label>
        <input id={`${prefixo}-authcode`} name="authcode" type="text" autoComplete="off" spellCheck={false} maxLength={200} required />
      </div>
      <div className="campo">
        <label htmlFor={`${prefixo}-usuario`}>Usuário</label>
        <input id={`${prefixo}-usuario`} name="local_user" type="text" autoComplete="off" spellCheck={false} maxLength={200} required />
      </div>
      <div className="campo">
        <label htmlFor={`${prefixo}-senha`}>Senha local</label>
        <input id={`${prefixo}-senha`} name="local_pwd" type="password" autoComplete="new-password" maxLength={200} required />
      </div>
    </>
  );
}

export function FormularioCamera({ arenaId, quadraId }: { arenaId: string; quadraId: string }) {
  const [estado, acao, pendente] = useActionState(cadastrarCameraAction, { erro: null, nome: "", sn: "" });
  const p = `camera-${quadraId}`;
  return (
    <form action={acao} className="formulario">
      <input type="hidden" name="arenaId" value={arenaId} />
      <input type="hidden" name="quadraId" value={quadraId} />
      <div className="campo">
        <label htmlFor={`${p}-nome`}>Nome</label>
        <input id={`${p}-nome`} name="nome" type="text" maxLength={200} defaultValue={estado.nome} required />
      </div>
      <div className="campo">
        <label htmlFor={`${p}-sn`}>SN</label>
        <input id={`${p}-sn`} name="sn" type="text" autoComplete="off" spellCheck={false} maxLength={200} defaultValue={estado.sn} required />
      </div>
      <CamposCredenciais prefixo={p} />
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <button type="submit" className="botao botao-cheio" disabled={pendente}>
        {pendente ? "Cadastrando…" : "Cadastrar câmera"}
      </button>
    </form>
  );
}

const inicialCredenciais: EstadoCredenciais = { erro: null, ok: false };

export function FormularioCredenciais({ arenaId, cameraId }: { arenaId: string; cameraId: string }) {
  const [estado, acao, pendente] = useActionState(atualizarCredenciaisAction, inicialCredenciais);
  return (
    <form action={acao} className="formulario">
      <input type="hidden" name="arenaId" value={arenaId} />
      <input type="hidden" name="cameraId" value={cameraId} />
      <CamposCredenciais prefixo={`credenciais-${cameraId}`} />
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? "Credenciais atualizadas." : ""}
      </p>
      <button type="submit" className="botao" disabled={pendente}>
        {pendente ? "Salvando…" : "Atualizar credenciais"}
      </button>
    </form>
  );
}

const inicialBotao: EstadoNovoBotao = { erro: null, token: null };

export function NovoBotao({ arenaId, quadraId }: { arenaId: string; quadraId: string }) {
  const [estado, acao, pendente] = useActionState(criarBotaoAction, inicialBotao);
  return (
    <div className="novo-botao">
      <form action={acao}>
        <input type="hidden" name="arenaId" value={arenaId} />
        <input type="hidden" name="quadraId" value={quadraId} />
        <button type="submit" className="botao botao-cheio" disabled={pendente}>
          {pendente ? "Criando…" : "Novo botão"}
        </button>
      </form>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      {/* O token só vive neste estado: recarregar a página o apaga da tela. */}
      <div role="status">
        {estado.token && (
          <div className="token">
            <p>
              <strong>Copie agora: este código não aparece de novo.</strong>
            </p>
            <code>{estado.token}</code>
          </div>
        )}
      </div>
    </div>
  );
}

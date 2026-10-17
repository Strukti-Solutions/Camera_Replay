"use client";

import { useActionState } from "react";
import {
  atualizarCredenciaisAction,
  cadastrarCameraAction,
  criarBotaoAction,
  type EstadoConfirmar,
  type EstadoCredenciais,
  type EstadoNovoBotao,
} from "./actions";

// Formulários da página da quadra. Todos funcionam sem JavaScript (a action
// roda no servidor); com JavaScript, o estado mostra erro e resultado.

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

export function FormularioCamera({ quadraId }: { quadraId: string }) {
  const [estado, acao, pendente] = useActionState(cadastrarCameraAction, { erro: null, nome: "", sn: "" });
  return (
    <form action={acao} className="formulario">
      <input type="hidden" name="quadraId" value={quadraId} />
      <div className="campo">
        <label htmlFor="camera-nome">Nome</label>
        <input id="camera-nome" name="nome" type="text" maxLength={200} defaultValue={estado.nome} required />
      </div>
      <div className="campo">
        <label htmlFor="camera-sn">SN</label>
        <input id="camera-sn" name="sn" type="text" autoComplete="off" spellCheck={false} maxLength={200} defaultValue={estado.sn} required />
      </div>
      <CamposCredenciais prefixo="camera" />
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

export function FormularioCredenciais({ cameraId }: { cameraId: string }) {
  const [estado, acao, pendente] = useActionState(atualizarCredenciaisAction, inicialCredenciais);
  return (
    <form action={acao} className="formulario">
      <input type="hidden" name="cameraId" value={cameraId} />
      <CamposCredenciais prefixo="credenciais" />
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

export function NovoBotao({ quadraId }: { quadraId: string }) {
  const [estado, acao, pendente] = useActionState(criarBotaoAction, inicialBotao);
  return (
    <div className="novo-botao">
      <form action={acao}>
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

// Ação destrutiva em dois cliques: o primeiro abre o <details>, o segundo
// confirma. Funciona sem JavaScript.
export function Confirmar({
  acao: acaoServidor,
  campo,
  valor,
  rotulo,
  pergunta,
  confirmar,
}: {
  acao: (estado: EstadoConfirmar, form: FormData) => Promise<EstadoConfirmar>;
  campo: string;
  valor: string;
  rotulo: string;
  pergunta: string;
  confirmar: string;
}) {
  const [estado, acao, pendente] = useActionState(acaoServidor, { erro: null });
  return (
    <div className="confirmar">
      <details>
        <summary className="botao botao-perigo">{rotulo}</summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name={campo} value={valor} />
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

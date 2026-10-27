"use client";

import { useEffect, useRef, useState } from "react";
import {
  baixarArquivoDoLance,
  mensagemDaFalha,
  nomeDoArquivoDoLance,
  podeCompartilharArquivos,
} from "./compartilhar-lance";

// "Compartilhar" do lance: baixa o .mp4 e abre a folha nativa do celular
// (WhatsApp, Instagram etc.). No servidor não se sabe se o navegador
// compartilha arquivos, então o botão só aparece depois de montar e se ele
// disser que sim; sem suporte fica só o "Baixar vídeo".
// O download é um fetch() da URL assinada do R2, de outra origem: depende da
// regra de CORS do bucket (README, "CORS do bucket do R2"). Sem ela, todo
// toque termina em MENSAGEM_FALHA. Não contornar aqui (proxy pelo app).
export function BotaoCompartilhar({ download, horario }: { download: string; horario: string }) {
  const [disponivel, setDisponivel] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  // O arquivo baixado fica guardado enquanto o lance está aberto: o toque
  // seguinte abre a folha na hora, sem baixar de novo.
  const arquivoRef = useRef<File | null>(null);
  // Um compartilhamento por vez (download + folha aberta).
  const ocupadoRef = useRef(false);
  const controleRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const exemplo = new File([], nomeDoArquivoDoLance(horario), { type: "video/mp4" });
    setDisponivel(podeCompartilharArquivos(navigator, exemplo));
  }, [horario]);

  // Fechou o lance no meio do download: cancela o download.
  useEffect(() => () => controleRef.current?.abort(), []);

  async function compartilhar() {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setMensagem("");
    let acabouDeBaixar = false;
    try {
      let arquivo = arquivoRef.current;
      if (!arquivo) {
        setPreparando(true);
        const controle = new AbortController();
        controleRef.current = controle;
        try {
          arquivo = await baixarArquivoDoLance(download, horario, fetch, controle.signal);
        } finally {
          setPreparando(false);
        }
        arquivoRef.current = arquivo;
        acabouDeBaixar = true;
      }
      if (!podeCompartilharArquivos(navigator, arquivo)) throw new Error("o navegador recusou o arquivo");
      await navigator.share({ files: [arquivo], title: `Lance de ${horario}` });
    } catch (erro) {
      // Download cancelado porque o lance fechou: não há onde mostrar nada.
      if (controleRef.current?.signal.aborted) return;
      setMensagem(mensagemDaFalha(erro, acabouDeBaixar) ?? "");
    } finally {
      ocupadoRef.current = false;
    }
  }

  if (!disponivel) return null;

  return (
    <>
      <button
        type="button"
        className="botao"
        // aria-disabled em vez de disabled: o foco não sai do botão (nem do
        // diálogo) enquanto o vídeo baixa.
        aria-disabled={preparando}
        aria-busy={preparando}
        onClick={compartilhar}
      >
        {preparando ? "Preparando…" : "Compartilhar"}
      </button>
      {/* A região viva fica sempre no DOM para ser anunciada. */}
      <p className="lance-acoes-aviso" role="status">
        {mensagem}
      </p>
    </>
  );
}

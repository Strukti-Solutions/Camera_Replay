"use client";

import { useEffect, useState } from "react";
import { cookieDoTema, lerTema, proximoTema, type Tema } from "./tema";

function temaEfetivo(): Tema {
  const marcado = lerTema(document.documentElement.dataset.tema);
  if (marcado) return marcado;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

// No servidor não se sabe o tema do aparelho (sem cookie): o botão sai neutro
// e se corrige ao montar, sem mudar de tamanho (o ícone ocupa a mesma caixa).
export function BotaoTema() {
  const [tema, setTema] = useState<Tema | null>(null);

  useEffect(() => {
    setTema(temaEfetivo());
  }, []);

  function alternar() {
    const novo = proximoTema(tema ?? temaEfetivo());
    document.documentElement.dataset.tema = novo;
    document.cookie = cookieDoTema(novo);
    setTema(novo);
  }

  return (
    <button
      type="button"
      className="botao-tema"
      onClick={alternar}
      aria-label={tema === "escuro" ? "Usar tema claro" : tema === "claro" ? "Usar tema escuro" : "Alternar tema"}
    >
      <span aria-hidden="true">{tema === "escuro" ? "☾" : tema === "claro" ? "☀" : "◐"}</span>
    </button>
  );
}

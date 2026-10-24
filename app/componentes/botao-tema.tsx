"use client";

import { useEffect, useState } from "react";
import { cookieDoTema, lerTema, proximoTema, type Tema } from "./tema";

function temaEfetivo(): Tema {
  const marcado = lerTema(document.documentElement.dataset.tema);
  if (marcado) return marcado;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

// Ícones em SVG: glifos de texto (☀ ☾ ◐) somem em fontes sem esses símbolos.
// Mesma caixa de 20 px nos três estados, então o botão não muda de tamanho.
function Icone({ tema }: { tema: Tema | null }) {
  const comum = { width: 20, height: 20, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  if (tema === "escuro") {
    return (
      <svg {...comum} fill="currentColor">
        <path d="M21 14.5A9 9 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5z" />
      </svg>
    );
  }
  if (tema === "claro") {
    return (
      <svg {...comum} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  return (
    <svg {...comum} fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

// `inicial` (cookie lido no servidor) faz o servidor já desenhar o ícone certo.
// No servidor não se sabe o tema do aparelho (sem cookie): o botão sai neutro
// e se corrige ao montar, sem mudar de tamanho (o ícone ocupa a mesma caixa).
export function BotaoTema({ inicial = null }: { inicial?: Tema | null }) {
  const [tema, setTema] = useState<Tema | null>(inicial);

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
      <Icone tema={tema} />
    </button>
  );
}

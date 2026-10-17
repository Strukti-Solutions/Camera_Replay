"use client";

// Botão que abre a janela de impressão. Sem JavaScript, o navegador
// continua imprimindo pelo menu (Ctrl+P) com a mesma folha.
export function ImprimirQr() {
  return (
    <button type="button" className="botao botao-cheio" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}

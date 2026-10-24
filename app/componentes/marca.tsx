import Link from "next/link";

// Assinatura horizontal da Strukti Soluções (MASTER §7). Sempre <img> com o
// nome completo no alt: o SVG inline repetido na página faria os ids dos
// gradientes colidirem. Largura e altura no HTML guardam a proporção do
// arquivo (1124 × 268) para a página não pular quando a imagem chega; o CSS
// fixa só a altura, então a marca nunca é esticada.
const ARQUIVO = {
  escuro: "/brand/strukti-assinatura-horizontal-fundo-escuro.svg",
  claro: "/brand/strukti-assinatura-horizontal-fundo-claro.svg",
} as const;

export function AssinaturaStrukti({ fundo, altura }: { fundo: "escuro" | "claro"; altura: number }) {
  return (
    <img
      src={ARQUIVO[fundo]}
      alt="Strukti Soluções"
      width={Math.round((altura * 1124.43) / 268)}
      height={altura}
      decoding="async"
    />
  );
}

// Marca do produto no topo: "Replay" em destaque e, discreto, o símbolo da
// Strukti com "por Strukti". Os dois símbolos vão no HTML e o CSS esconde um
// conforme o tema (funciona sem JS). alt vazio: o texto já diz Strukti.
export function MarcaReplay() {
  return (
    <Link href="/" className="marca-replay">
      <span className="marca-replay-nome">Replay</span>
      <span className="marca-replay-strukti">
        <img className="simbolo-claro" src="/brand/strukti-simbolo-fundo-claro.svg" alt="" width={11} height={14} decoding="async" />
        <img className="simbolo-escuro" src="/brand/strukti-simbolo-fundo-escuro.svg" alt="" width={11} height={14} decoding="async" />
        <span>por Strukti</span>
      </span>
    </Link>
  );
}

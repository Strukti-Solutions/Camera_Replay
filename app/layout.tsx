import type { Metadata, Viewport } from "next";
import { Geologica } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { lerTema } from "./componentes/tema";
import "./globals.css";

// Fonte do design system da Strukti. next/font baixa o arquivo no build e o
// serve pelo próprio site: nenhuma requisição externa quando a página abre.
// Eixo SHRP: o corte em ângulo dos títulos, o mesmo das faces do hexágono.
const geologica = Geologica({
  subsets: ["latin"],
  axes: ["SHRP"],
  display: "swap",
  variable: "--font-geologica",
});

export const metadata: Metadata = {
  title: { default: "Replay", template: "%s – Replay" },
};

// Cor do topo em cada tema (--superficie no globals.css), que é o que o navegador pinta. Com tema escolhido pelo cookie,
// vale a cor dele; sem cookie, a do esquema do aparelho.
const FUNDO = { claro: "#ffffff", escuro: "#15273b" } as const;

export async function generateViewport(): Promise<Viewport> {
  const escolhido = lerTema((await cookies()).get("tema")?.value);
  return {
    width: "device-width",
    initialScale: 1,
    colorScheme: escolhido ? (escolhido === "claro" ? "light" : "dark") : "light dark",
    themeColor: escolhido
      ? FUNDO[escolhido]
      : [
          { media: "(prefers-color-scheme: light)", color: FUNDO.claro },
          { media: "(prefers-color-scheme: dark)", color: FUNDO.escuro },
        ],
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const tema = lerTema((await cookies()).get("tema")?.value);
  return (
    <html lang="pt-BR" className={geologica.variable} data-tema={tema ?? undefined}>
      <body>{children}</body>
    </html>
  );
}

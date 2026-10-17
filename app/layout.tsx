import type { Metadata, Viewport } from "next";
import { Geologica } from "next/font/google";
import type { ReactNode } from "react";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  // A faixa do topo é o "espaço" da marca nos dois temas.
  themeColor: "#08121d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={geologica.variable}>
      <body>{children}</body>
    </html>
  );
}

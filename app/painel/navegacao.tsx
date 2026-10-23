"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Navegação do painel. aria-current marca a seção atual (para leitor de tela
// e para o destaque visual); o detalhe e o QR da quadra contam como Quadras.
const SECOES = [
  { href: "/painel", rotulo: "Quadras", ativa: (p: string) => p === "/painel" || p.startsWith("/painel/quadras") },
];

export function NavegacaoPainel() {
  const caminho = usePathname() ?? "";
  return (
    <nav aria-label="Painel" className="painel-nav">
      <ul>
        {SECOES.map((s) => (
          <li key={s.href}>
            <Link href={s.href} aria-current={s.ativa(caminho) ? "page" : undefined}>
              {s.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

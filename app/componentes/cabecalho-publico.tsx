import Link from "next/link";
import type { SessaoJogador } from "@/app/lib/jogadores";
import { sairJogadorAction } from "@/app/jogador/actions";
import { Topo } from "./topo";
import { linksDoCabecalhoPublico } from "./topo-links";

// Topo das telas públicas. `voltar` (já validado) é para onde o jogador volta
// depois de entrar ou criar a conta.
export function CabecalhoPublico({ sessao, voltar = null }: { sessao: SessaoJogador | null; voltar?: string | null }) {
  return (
    <Topo>
      <nav className="cabecalho-links" aria-label="Conta">
        {linksDoCabecalhoPublico(sessao !== null, voltar).map((l) => (
          <Link key={l.href} href={l.href}>
            {l.texto}
          </Link>
        ))}
        {sessao && (
          <form action={sairJogadorAction}>
            <button type="submit" className="cabecalho-sair">Sair</button>
          </form>
        )}
      </nav>
    </Topo>
  );
}

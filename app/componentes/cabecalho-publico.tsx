import Link from "next/link";
import type { SessaoJogador } from "@/app/lib/jogadores";
import { sairJogadorAction } from "@/app/jogador/actions";
import { MarcaDaFaixa } from "./marca";

// Faixa das telas públicas: a marca e os atalhos da conta do jogador.
export function CabecalhoPublico({ sessao }: { sessao: SessaoJogador | null }) {
  return (
    <header className="faixa faixa-so-marca">
      <div className="miolo cabecalho-publico">
        <MarcaDaFaixa />
        <nav className="cabecalho-links" aria-label="Conta">
          {sessao ? (
            <>
              <Link href="/minhas-reservas">Minhas reservas</Link>
              <form action={sairJogadorAction}>
                <button type="submit" className="cabecalho-sair">Sair</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/entrar">Entrar</Link>
              <Link href="/criar-conta">Criar conta</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

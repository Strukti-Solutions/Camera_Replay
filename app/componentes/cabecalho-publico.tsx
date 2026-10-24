import Link from "next/link";
import type { SessaoJogador } from "@/app/lib/jogadores";
import { sairJogadorAction } from "@/app/jogador/actions";
import { Topo } from "./topo";
import { linksDoCabecalhoPublico, type IconeDoTopo, type LinkDoTopo } from "./topo-links";

const TRACOS: Record<IconeDoTopo, React.ReactNode> = {
  buscar: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  reservas: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  conta: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </>
  ),
};

function Icone({ nome }: { nome: IconeDoTopo }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TRACOS[nome]}
    </svg>
  );
}

function LinkDoCabecalho({ link }: { link: LinkDoTopo }) {
  if (link.estilo === "icone") {
    return (
      <Link href={link.href} className="topo-botao topo-botao-icone" aria-label={link.texto} title={link.texto}>
        {link.icone && <Icone nome={link.icone} />}
      </Link>
    );
  }
  return (
    <Link href={link.href} className={link.estilo === "destaque" ? "topo-botao topo-botao-destaque" : "topo-botao"}>
      {link.icone && <Icone nome={link.icone} />}
      {link.curto ? (
        <>
          <span className="topo-texto-longo">{link.texto}</span>
          <span className="topo-texto-curto">{link.curto}</span>
        </>
      ) : (
        link.texto
      )}
    </Link>
  );
}

// Topo das telas públicas. `voltar` (já validado) é para onde o jogador volta
// depois de entrar ou criar a conta.
export function CabecalhoPublico({ sessao, voltar = null }: { sessao: SessaoJogador | null; voltar?: string | null }) {
  return (
    <Topo>
      <nav className="cabecalho-links" aria-label="Principal">
        {linksDoCabecalhoPublico(sessao !== null, voltar).map((l) => (
          <LinkDoCabecalho key={l.href} link={l} />
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

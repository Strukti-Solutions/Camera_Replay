import { sairAction } from "@/app/entrar/actions";
import { NavegacaoPainel } from "./navegacao";
import { exigirSessao } from "./sessao-atual";

// Tudo sob /painel exige sessão; o redirecionamento acontece aqui.
export const dynamic = "force-dynamic";

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const sessao = await exigirSessao();
  return (
    <>
      <header className="faixa">
        <div className="miolo">
          <p className="painel-arena">{sessao.arenaNome}</p>
          <form action={sairAction}>
            <button type="submit" className="botao">
              Sair
            </button>
          </form>
          <NavegacaoPainel />
        </div>
      </header>
      {children}
    </>
  );
}

import { sairAction } from "@/app/entrar/actions";
import { Topo } from "@/app/componentes/topo";
import { NavegacaoPainel } from "./navegacao";
import { exigirSessao } from "./sessao-atual";

// Tudo sob /painel exige sessão; o redirecionamento acontece aqui.
export const dynamic = "force-dynamic";

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const sessao = await exigirSessao();
  return (
    <>
      <Topo rotulo={sessao.arenaNome}>
        <NavegacaoPainel />
        <form action={sairAction}>
          <button type="submit" className="cabecalho-sair">Sair</button>
        </form>
      </Topo>
      {children}
    </>
  );
}

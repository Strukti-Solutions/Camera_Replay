import { MarcaDaFaixa } from "@/app/componentes/marca";
import { sairAdminAction } from "./entrar/actions";

// Faixa do topo de /admin: assinatura Strukti e o rótulo "Administração";
// com sessão, o botão Sair.
export function CabecalhoAdmin({ comSair }: { comSair: boolean }) {
  return (
    <header className="faixa">
      <div className="miolo">
        <MarcaDaFaixa />
        <p className="painel-arena">Administração</p>
        {comSair && (
          <form action={sairAdminAction}>
            <button type="submit" className="botao">
              Sair
            </button>
          </form>
        )}
      </div>
    </header>
  );
}

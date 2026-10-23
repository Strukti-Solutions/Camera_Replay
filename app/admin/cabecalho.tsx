import { MarcaDaFaixa } from "@/app/componentes/marca";
import { sairAdminAction } from "./entrar/actions";

// Faixa do topo de /admin: assinatura Strukti, o rótulo "Administração" e o
// botão Sair (o login fica em /entrar, então toda tela daqui tem sessão).
export function CabecalhoAdmin() {
  return (
    <header className="faixa">
      <div className="miolo">
        <MarcaDaFaixa />
        <p className="painel-arena">Administração</p>
        <form action={sairAdminAction}>
          <button type="submit" className="botao">
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}

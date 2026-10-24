import { Topo } from "@/app/componentes/topo";
import { sairAdminAction } from "./entrar/actions";

// Topo de /admin: marca, o rótulo "Administração" e o botão Sair (o login fica
// em /entrar, então toda tela daqui tem sessão).
export function CabecalhoAdmin() {
  return (
    <Topo rotulo="Administração">
      <form action={sairAdminAction}>
        <button type="submit" className="cabecalho-sair">Sair</button>
      </form>
    </Topo>
  );
}

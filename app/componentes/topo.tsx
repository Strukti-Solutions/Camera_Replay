import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { BotaoTema } from "./botao-tema";
import { MarcaReplay } from "./marca";
import { lerTema } from "./tema";

// Topo único das telas: marca Replay, rótulo opcional (arena, "Administração"),
// navegação e Sair em `children` e o botão de tema sempre por último. Lê o
// cookie do tema aqui para o botão já sair com o ícone certo.
export async function Topo({ children, rotulo }: { children?: ReactNode; rotulo?: string }) {
  const tema = lerTema((await cookies()).get("tema")?.value);
  return (
    <header className="topo">
      <div className="miolo-largo topo-miolo">
        <MarcaReplay />
        {rotulo && <p className="topo-rotulo">{rotulo}</p>}
        <div className="topo-acoes">
          {children}
        </div>
        <BotaoTema inicial={tema} />
      </div>
    </header>
  );
}

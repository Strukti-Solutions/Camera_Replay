import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MarcaDaFaixa } from "@/app/componentes/marca";
import { LinkVoltar } from "@/app/componentes/voltar";
import { sessaoAtual } from "@/app/painel/sessao-atual";
import { FormularioEntrar } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

export default async function PaginaEntrar() {
  if (await sessaoAtual()) redirect("/painel");
  return (
    <>
      <header className="faixa faixa-so-marca">
        <div className="miolo">
          <MarcaDaFaixa />
        </div>
      </header>
      <main className="miolo entrar">
        <LinkVoltar href="/" />
        <p className="entrar-quadra">Painel do dono</p>
        <h1>Entrar como dono da arena</h1>
        <p className="entrar-dica">Acesso de quem administra a arena.</p>
        <FormularioEntrar />
      </main>
    </>
  );
}

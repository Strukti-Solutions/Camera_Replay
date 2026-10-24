import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LinkVoltar } from "@/app/componentes/voltar";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";
import { FormularioEsqueci } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Esqueci a senha",
  robots: { index: false, follow: false },
};

// Vale para jogador, dono e admin: o e-mail diz o tipo da conta.
export default async function PaginaEsqueci() {
  const sessao = await sessaoJogadorAtual();
  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo entrar">
        <LinkVoltar href="/entrar" />
        <h1>Esqueci a senha</h1>
        <p>Digite o e-mail da sua conta. Enviamos um link para você escolher uma nova senha.</p>
        <FormularioEsqueci />
        <p className="entrar-links">
          <Link href="/entrar">Entrar</Link>
        </p>
      </main>
    </>
  );
}

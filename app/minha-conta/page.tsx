import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LinkVoltar } from "@/app/componentes/voltar";
import { exigirJogador } from "@/app/jogador/sessao-jogador";
import { FormularioApagar, FormularioNome, FormularioSenha } from "./formularios";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Minha conta",
  robots: { index: false, follow: false },
};

export default async function MinhaConta() {
  const sessao = await exigirJogador();
  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo entrar">
        <LinkVoltar href="/minhas-reservas" />
        <h1>Minha conta</h1>
        <p className="entrar-dica">{sessao.email}</p>
        <section className="conta-bloco">
          <h2>Nome</h2>
          <FormularioNome nome={sessao.nome} />
        </section>
        <section className="conta-bloco">
          <h2>Senha</h2>
          <FormularioSenha />
        </section>
        <section className="conta-bloco">
          <h2>Apagar conta</h2>
          <p>
            Isso apaga sua conta e o histórico. Veja o que guardamos nos <Link href="/termos">termos</Link>.
          </p>
          <FormularioApagar />
        </section>
      </main>
    </>
  );
}

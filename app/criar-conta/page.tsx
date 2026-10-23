import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LinkVoltar } from "@/app/componentes/voltar";
import { caminhoSeguro } from "@/app/lib/entrar-unico";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";
import { FormularioCriarConta } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Criar conta",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ voltar?: string | string[] }> };

export default async function PaginaCriarConta({ searchParams }: Props) {
  const voltar = caminhoSeguro((await searchParams).voltar);
  const sessao = await sessaoJogadorAtual();
  if (sessao) redirect(voltar ?? "/minhas-reservas");

  const entrar = voltar ? `/entrar?voltar=${encodeURIComponent(voltar)}` : "/entrar";
  return (
    <>
      <CabecalhoPublico sessao={null} />
      <main className="miolo entrar">
        <LinkVoltar href="/" />
        <h1>Criar conta</h1>
        <FormularioCriarConta voltar={voltar} />
        <p className="entrar-links">
          <Link href={entrar}>Já tenho conta</Link>
        </p>
      </main>
    </>
  );
}

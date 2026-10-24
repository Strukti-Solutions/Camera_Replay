import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LinkVoltar } from "@/app/componentes/voltar";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";
import { FormularioRedefinir } from "./formulario";

export const dynamic = "force-dynamic";

// no-referrer: o token do link nunca sai desta página no cabeçalho Referer.
export const metadata: Metadata = {
  title: "Redefinir senha",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Props = { searchParams: Promise<{ t?: string | string[] }> };

// A página não confere o link (só lê a sessão do jogador para o cabeçalho): o
// link só é conferido quando a senha é enviada.
export default async function PaginaRedefinir({ searchParams }: Props) {
  const t = (await searchParams).t;
  const token = typeof t === "string" && FORMATO_TOKEN.test(t) ? t : null;
  const sessao = await sessaoJogadorAtual();
  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo entrar">
        <LinkVoltar href="/entrar" />
        <h1>Redefinir senha</h1>
        {token ? (
          <FormularioRedefinir token={token} />
        ) : (
          <>
            <p className="erro-form" role="alert">Link inválido ou vencido. Peça um novo.</p>
            <p className="entrar-links"><Link href="/esqueci-a-senha">Pedir um novo link</Link></p>
          </>
        )}
      </main>
    </>
  );
}

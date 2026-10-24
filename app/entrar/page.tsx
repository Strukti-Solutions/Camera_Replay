import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Topo } from "@/app/componentes/topo";
import { LinkVoltar } from "@/app/componentes/voltar";
import { envioEmailConfigurado } from "@/app/lib/email";
import { caminhoSeguro, destinoDoTipo } from "@/app/lib/entrar-unico";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";
import { sessaoAtual } from "@/app/painel/sessao-atual";
import { FormularioEntrar } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ voltar?: string | string[] }> };

// Login único de jogador, dono e super admin: o e-mail diz o tipo da conta.
// O cookie do admin tem path /admin e não chega aqui; quem já está logado como
// admin passa por /admin/entrar, que o manda direto para /admin.
export default async function PaginaEntrar({ searchParams }: Props) {
  const voltar = caminhoSeguro((await searchParams).voltar);
  if (await sessaoAtual()) redirect(destinoDoTipo("dono"));
  if (await sessaoJogadorAtual()) redirect(voltar ?? destinoDoTipo("jogador"));

  const criarConta = voltar ? `/criar-conta?voltar=${encodeURIComponent(voltar)}` : "/criar-conta";
  return (
    <>
      <Topo />
      <main className="miolo entrar">
        <LinkVoltar href="/" />
        <h1>Entrar</h1>
        <FormularioEntrar voltar={voltar} />
        <p className="entrar-links">
          <Link href={criarConta}>Criar conta</Link>
          {/* Em produção, sem envio de e-mail configurado, o link não aparece. */}
          {envioEmailConfigurado() && <Link href="/esqueci-a-senha">Esqueci a senha</Link>}
        </p>
      </main>
    </>
  );
}

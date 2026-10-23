import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { exigirJogador } from "@/app/jogador/sessao-jogador";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Minhas reservas",
  robots: { index: false, follow: false },
};

export default async function MinhasReservas() {
  const sessao = await exigirJogador();
  const primeiroNome = sessao.nome.trim().split(/\s+/)[0] ?? sessao.nome;
  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo entrar">
        <h1>Olá, {primeiroNome}</h1>
        <p>Você ainda não tem reservas.</p>
        <p className="entrar-links">
          <Link href="/minha-conta">Minha conta</Link>
        </p>
      </main>
    </>
  );
}

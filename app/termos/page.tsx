import type { Metadata } from "next";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LinkVoltar } from "@/app/componentes/voltar";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Termos de uso e privacidade" };

export default async function Termos() {
  const sessao = await sessaoJogadorAtual();
  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo termos">
        <LinkVoltar href="/" />
        <h1>Termos de uso e privacidade</h1>
        <p className="termos-aviso"><strong>Texto provisório.</strong> Será revisado antes do lançamento.</p>

        <h2>Quem somos</h2>
        <p>
          O serviço de replay é da Strukti Soluções. Para falar com a gente:{" "}
          <a href="mailto:struktisolutions@gmail.com">struktisolutions@gmail.com</a>.
        </p>

        <h2>O que guardamos</h2>
        <ul>
          <li>Seu nome e seu e-mail, para a sua conta.</li>
          <li>Os vídeos dos lances (replays) da quadra, por até 3 dias. Depois disso eles são apagados.</li>
        </ul>

        <h2>Para que usamos</h2>
        <p>Só para entregar o replay e manter a sua conta e as suas reservas. Não vendemos seus dados.</p>

        <h2>Como apagar a sua conta</h2>
        <p>
          Entre em &quot;Minha conta&quot; e use &quot;Apagar conta&quot;. Seu nome, seu e-mail e o histórico
          são apagados. Se preferir, escreva para o e-mail acima.
        </p>
      </main>
    </>
  );
}

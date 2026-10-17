import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { detalheQuadra } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { ImprimirQr } from "./imprimir";

// Depende da sessão e da quadra; nada aqui pode ser servido do cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "QR da quadra",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

// URL pública da página do jogador, sem barra no fim. O slug é codificado
// para que o QR nunca carregue nada além de um caminho dentro de /q/.
function urlDaQuadra(appUrl: string, slug: string): string {
  return `${appUrl.replace(/\/+$/, "")}/q/${encodeURIComponent(slug)}`;
}

export default async function PaginaQr({ params }: Props) {
  const sessao = await exigirSessao();
  const { id } = await params;
  const quadra = await detalheQuadra(poolCompartilhado(), sessao.arenaId, id);
  if (!quadra) notFound();

  const appUrl = process.env.APP_URL?.trim();
  const voltar = (
    <p className="nao-imprimir">
      <Link href={`/painel/quadras/${quadra.id}`}>← {quadra.nome}</Link>
    </p>
  );

  if (!appUrl) {
    return (
      <main className="miolo painel">
        {voltar}
        <h1>QR da quadra</h1>
        <p role="alert">Configure APP_URL para gerar o QR.</p>
      </main>
    );
  }

  const url = urlDaQuadra(appUrl, quadra.slug);
  // Saída da biblioteca para uma URL montada aqui (não é texto do usuário
  // solto): por isso é seguro inserir o SVG como HTML.
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });

  return (
    <main className="miolo painel">
      {voltar}
      <h1 className="nao-imprimir">QR da quadra</h1>
      <p className="nao-imprimir">
        Imprima esta folha e cole perto do botão da quadra.
      </p>
      <p className="nao-imprimir">
        <ImprimirQr />
      </p>
      <section className="folha-qr" aria-labelledby="folha-titulo">
        <p className="folha-quadra">{quadra.nome}</p>
        <h2 id="folha-titulo">Quadra com gravação de vídeo</h2>
        <p>
          Aperte o botão da quadra para salvar os últimos 30 segundos. Aponte a câmera do celular
          para o código e assista aos seus lances.
        </p>
        <div
          className="qr-codigo"
          role="img"
          aria-label={`QR code que abre ${url}`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="folha-url">{url}</p>
      </section>
    </main>
  );
}

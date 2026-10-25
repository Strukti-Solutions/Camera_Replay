import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { CartaoInclinavel } from "@/app/componentes/cartao-inclinavel";
import { AssinaturaStrukti } from "@/app/componentes/marca";
import { slugDaArena } from "@/app/lib/arena-slug";
import { listarQuadras } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoCamera, urlDaArena } from "./apresentacao";
import { ImprimirQr } from "./imprimir-qr";
import { exigirSessao } from "./sessao-atual";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quadras",
  robots: { index: false, follow: false },
};

export default async function PaginaPainel() {
  // A página confere a sessão por conta própria: o layout não roda de novo
  // em toda navegação do cliente.
  const sessao = await exigirSessao();
  const db = poolCompartilhado();
  const [quadras, slug] = await Promise.all([
    listarQuadras(db, sessao.arenaId),
    slugDaArena(db, sessao.arenaId),
  ]);

  return (
    <main className="miolo painel">
      <h1 className="nao-imprimir">Quadras</h1>

      {quadras.length === 0 ? (
        <p className="painel-vazio nao-imprimir">Nenhuma quadra cadastrada. A Strukti cadastra as quadras da sua arena.</p>
      ) : (
        <ul className="cartoes nao-imprimir">
          {quadras.map((q) => (
            <CartaoInclinavel key={q.id} className="cartao cartao-com-capa">
              <div className="capa-quadra vidro" aria-hidden="true">
                {q.capaId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- rota própria, já com cache
                  <img src={`/fotos/${q.capaId}`} alt="" loading="lazy" />
                ) : (
                  <span>{q.esporte || "Sem foto"}</span>
                )}
              </div>
              <h2>
                <Link href={`/painel/quadras/${q.id}`}>{q.nome}</Link>
              </h2>
              <dl className="dados">
                <div>
                  <dt>Câmera</dt>
                  <dd>
                    <span className={`estado estado-${q.camera ? (q.camera.online ? "on" : "off") : "nenhum"}`}>
                      {textoCamera(q.camera)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Botões ativos</dt>
                  <dd>{q.botoesAtivos}</dd>
                </div>
              </dl>
            </CartaoInclinavel>
          ))}
        </ul>
      )}

      {/* O QR da arena fica no fim da tela, depois da lista. */}
      <QrDaArena arena={sessao.arenaNome} slug={slug} />
    </main>
  );
}

// Um QR só para a arena inteira: abre a página da arena. Ao imprimir, só a folha aparece.
async function QrDaArena({ arena, slug }: { arena: string; slug: string | null }) {
  const appUrl = process.env.APP_URL?.trim();
  const titulo = (
    <h2 id="titulo-qr" className="nao-imprimir">
      QR da arena
    </h2>
  );

  if (!appUrl || !slug) {
    return (
      <section className="secao secao-qr" aria-labelledby="titulo-qr">
        {titulo}
        <p role="alert">Configure APP_URL para gerar o QR.</p>
      </section>
    );
  }

  const url = urlDaArena(appUrl, slug);
  // Saída da biblioteca para uma URL montada aqui (não é texto do usuário
  // solto): por isso é seguro inserir o SVG como HTML.
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });

  return (
    <section className="secao secao-qr" aria-labelledby="titulo-qr">
      {titulo}
      <p className="nao-imprimir">
        <ImprimirQr />
      </p>
      <div className="folha-qr">
        <p className="folha-quadra">{arena}</p>
        <h3>Quadra com gravação de vídeo</h3>
        <p>
          Aperte o botão da quadra para salvar os últimos 30 segundos. Aponte a câmera do celular para o
          código, entre ou crie sua conta e veja os seus lances.
        </p>
        <div
          className="qr-codigo"
          role="img"
          aria-label={`QR code que abre ${url}`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="folha-url">{url}</p>
        {/* Papel branco: a assinatura de fundo claro, sem nada escrito ao lado. */}
        <div className="folha-marca">
          <AssinaturaStrukti fundo="claro" altura={32} />
        </div>
      </div>
    </section>
  );
}

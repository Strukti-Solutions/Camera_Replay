import type { Metadata } from "next";
import { cache, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { LinkVoltar } from "@/app/componentes/voltar";
import { MENSAGEM_ARENA_SUSPENSA } from "@/app/entrar/mensagens";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";
import { arenaPublica, periodosPublicos, periodosPublicosEntre } from "@/app/lib/arenas-publicas";
import { diasDisponiveis } from "@/app/lib/disponibilidade";
import { poolCompartilhado } from "@/app/lib/pool";
import {
  diaPorExtenso, hrefPasso1, hrefPasso2, lerEscolha, lerMes, linhaEndereco, linkComoChegar, livresPorDia,
  mesesDaJanela, passoDaUrl,
} from "./apresentacao";
import { EscolhaDaQuadra } from "./escolha";
import { FotosDaArena } from "./fotos-arena";
import { CabecaDoPasso, Passo1, Passo2 } from "./passos";

// generateMetadata e a página pedem a mesma arena: uma consulta por requisição.
const arenaDaRequisicao = cache((slug: string) => arenaPublica(poolCompartilhado(), slug));

// Página pública da arena (QR code e busca). Status, horários e preços mudam a
// qualquer hora e o "agora" decide os horários livres: nada de cache.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const arena = await arenaDaRequisicao(slug);
  if (!arena) return { title: "Arena não encontrada", robots: { index: false, follow: false } };
  return {
    title: arena.nome,
    // Só arena ativa entra no buscador; suspensa continua fora.
    robots: arena.ativa ? { index: true, follow: true } : { index: false, follow: false },
  };
}

// Foto parada dos passos 2 e 3, ou fundo neutro com um texto.
function FotoParada({ id, etiqueta, alt }: { id: string | null; etiqueta: string; alt: string }) {
  if (!id) return <div className="ar-sem-foto">{etiqueta}</div>;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- rota própria, já com cache */}
      <img src={`/fotos/${id}`} alt={alt} className="ar-foto ar-foto-atual" />
      <span className="ar-etiqueta">{etiqueta}</span>
    </>
  );
}

export default async function PaginaDaArena({ params, searchParams }: Props) {
  const { slug } = await params;
  const arena = await arenaDaRequisicao(slug);
  if (!arena) notFound();
  const sessao = await sessaoJogadorAtual();

  if (!arena.ativa) {
    return (
      <>
        <CabecalhoPublico sessao={sessao} voltar={`/a/${arena.slug}`} />
        <main className="miolo arena-publica">
          <LinkVoltar href="/" />
          <h1>{arena.nome}</h1>
          <p>{MENSAGEM_ARENA_SUSPENSA}</p>
        </main>
      </>
    );
  }

  const agora = new Date();
  const p = await searchParams;
  const ids = arena.quadras.map((q) => q.id);
  const escolha = lerEscolha(p, ids, agora);
  const passo = passoDaUrl(p, ids, agora);
  const quadra = arena.quadras.find((q) => q.id === escolha.quadra) ?? null;
  const endereco = linhaEndereco(arena.endereco);
  const comoChegar = linkComoChegar(arena);
  const db = poolCompartilhado();

  // Uma consulta de períodos, só para a quadra escolhida.
  let cartao: ReactNode;
  let voltar: { href: string; texto: string } | null = null;
  if (!quadra) {
    cartao = <Passo1 slug={arena.slug} quadras={arena.quadras} />;
  } else if (passo === 2) {
    const janela = diasDisponiveis(agora);
    const ocupados = await periodosPublicosEntre(db, quadra.id, janela[0].valor, janela[janela.length - 1].valor);
    voltar = { href: hrefPasso1(arena.slug), texto: [quadra.nome, quadra.esporte].filter(Boolean).join(" · ") };
    cartao = (
      <Passo2
        slug={arena.slug}
        quadra={quadra.id}
        mes={lerMes(p.mes, agora)}
        meses={mesesDaJanela(agora)}
        agora={agora}
        livres={livresPorDia(quadra.horarios, agora, ocupados)}
      />
    );
  } else {
    const ocupados = await periodosPublicos(db, quadra.id, escolha.dia);
    voltar = { href: hrefPasso2(arena.slug, quadra.id, escolha.dia.slice(0, 7)), texto: diaPorExtenso(escolha.dia) };
    cartao = (
      <EscolhaDaQuadra
        slug={arena.slug}
        quadra={quadra}
        dia={escolha.dia}
        inicio={escolha.inicio}
        qtd={escolha.qtd}
        agora={agora}
        ocupados={ocupados}
      />
    );
  }

  const balao = (
    <>
      <span className="ar-pino" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
        </svg>
      </span>
      <span className="ar-balao-texto">
        <h1>{arena.nome}</h1>
        {endereco && <span className="suave">{endereco}</span>}
      </span>
      {comoChegar && <span className="ar-como-chegar">Como chegar ›</span>}
    </>
  );

  const etiquetaQuadra = quadra ? [quadra.nome, quadra.esporte].filter(Boolean).join(" · ") : "";

  return (
    <>
      <CabecalhoPublico sessao={sessao} voltar={`/a/${arena.slug}`} />
      <main className="miolo-largo arena-publica">
        <LinkVoltar href="/" />
        {comoChegar ? (
          <a className="ar-balao" href={comoChegar} target="_blank" rel="noopener noreferrer">
            {balao}
          </a>
        ) : (
          <div className="ar-balao">{balao}</div>
        )}

        <div className="ar-metades">
          <div className="ar-palco">
            {!quadra ? (
              arena.fotos.length > 0 ? (
                <FotosDaArena fotos={arena.fotos} nome={arena.nome} />
              ) : (
                <div className="ar-sem-foto">{arena.nome}</div>
              )
            ) : (
              <FotoParada
                id={quadra.capaId ?? arena.fotos[0] ?? null}
                etiqueta={quadra.capaId || arena.fotos[0] ? etiquetaQuadra : quadra.esporte || quadra.nome}
                alt={quadra.capaId ? `Foto da ${quadra.nome}` : `Foto da ${arena.nome}`}
              />
            )}
          </div>

          <section id="reserva" className="cartao ar-cartao" aria-label="Reserva">
            <CabecaDoPasso passo={quadra ? passo : 1} voltar={voltar} />
            {cartao}
          </section>
        </div>
      </main>
    </>
  );
}

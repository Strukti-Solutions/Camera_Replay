import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { CabecalhoPublico } from "@/app/componentes/cabecalho-publico";
import { MENSAGEM_ARENA_SUSPENSA } from "@/app/entrar/mensagens";
import { sessaoJogadorAtual } from "@/app/jogador/sessao-jogador";
import { arenaPublica } from "@/app/lib/arenas-publicas";
import { hojeLocal } from "@/app/lib/disponibilidade";
import { poolCompartilhado } from "@/app/lib/pool";
import { lerEscolha, linhaEndereco, linkComoChegar } from "./apresentacao";
import { EscolhaDaQuadra } from "./escolha";

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

export default async function PaginaDaArena({ params, searchParams }: Props) {
  const { slug } = await params;
  const arena = await arenaDaRequisicao(slug);
  if (!arena) notFound();
  const sessao = await sessaoJogadorAtual();

  if (!arena.ativa) {
    return (
      <>
        <CabecalhoPublico sessao={sessao} />
        <main className="miolo arena-publica">
          <h1>{arena.nome}</h1>
          <p>{MENSAGEM_ARENA_SUSPENSA}</p>
        </main>
      </>
    );
  }

  const agora = new Date();
  const escolha = lerEscolha(await searchParams, arena.quadras.map((q) => q.id), agora);
  const endereco = linhaEndereco(arena.endereco);
  const comoChegar = linkComoChegar(arena);
  const hoje = hojeLocal(agora);

  return (
    <>
      <CabecalhoPublico sessao={sessao} />
      <main className="miolo arena-publica">
        <h1>{arena.nome}</h1>
        {(endereco || comoChegar) && (
          <p className="arena-endereco">
            {endereco && <span>{endereco}</span>}
            {comoChegar && (
              <a href={comoChegar} target="_blank" rel="noopener noreferrer">
                Como chegar
              </a>
            )}
          </p>
        )}

        {arena.quadras.length === 0 ? (
          <p className="suave">Reservas indisponíveis</p>
        ) : (
          <ul className="cartoes quadras-publicas">
            {arena.quadras.map((q) => {
              // Só a quadra do formulário enviado recebe a escolha; as outras abrem em hoje.
              const minha = escolha.quadra === q.id;
              return (
                <li key={q.id} id={`quadra-${q.id}`} className="cartao">
                  <h2>{q.nome}</h2>
                  {q.esporte && <p className="suave">{q.esporte}</p>}
                  <EscolhaDaQuadra
                    slug={arena.slug}
                    quadra={q}
                    dia={minha ? escolha.dia : hoje}
                    inicio={minha ? escolha.inicio : null}
                    horas={minha ? escolha.horas : 1}
                    agora={agora}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}

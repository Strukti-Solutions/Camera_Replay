import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lancesAvulsosDoAluno, reservasDoAluno } from "@/app/lib/acesso-aluno";
import { poolCompartilhado } from "@/app/lib/pool";
import { MarcaDaFaixa } from "@/app/componentes/marca";
import { primeiroNome, textoDia, textoLances, tituloReservaNaQuadra } from "./apresentacao";
import { sairAlunoAction } from "./entrar/actions";
import { TelaEntrar } from "./entrar/tela";
import { semR2 } from "./galeria";
import { arenaEAluno } from "./sessao-aluno";

// A lista muda a cada aperto do botão e depende do aluno logado: nada de cache.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const dados = await arenaEAluno(slug);
  return {
    title: dados?.arena ?? "Arena não encontrada",
    robots: { index: false, follow: false },
  };
}

// Página aberta pelo QR da arena. Sem sessão é a tela de entrar: nenhuma
// reserva, horário ou nome aparece. Com sessão, só as reservas do aluno logado,
// em todas as quadras da arena, e o atalho para os lances avulsos dele.
export default async function PaginaDaArena({ params }: Props) {
  const { slug } = await params;
  const dados = await arenaEAluno(slug);
  if (!dados) notFound();
  const { aluno } = dados;
  if (!aluno) return <TelaEntrar slug={slug} arena={dados.arena} reserva={null} />;

  const pool = poolCompartilhado();
  const [doAluno, avulsosLista] = await Promise.all([
    reservasDoAluno(pool, slug, aluno.alunoId),
    // Só a contagem: o leitor que não assina evita gerar URL que ninguém vai usar.
    lancesAvulsosDoAluno(pool, semR2, slug, aluno.alunoId),
  ]);
  const reservas = doAluno?.reservas ?? [];
  const avulsos = avulsosLista.length;
  // Dia formatado no servidor, com o relógio dele.
  const agora = new Date();

  return (
    <>
      <header className="faixa">
        <div className="miolo">
          <MarcaDaFaixa />
          <h1>{dados.arena}</h1>
          {/* Link comum (não <Link>) para recarregar de verdade, inclusive sem JavaScript. */}
          <a className="botao" href={`/a/${slug}`}>
            Atualizar lista
          </a>
        </div>
      </header>

      <main className="miolo quadra-publica">
        <div className="aluno-barra">
          <p className="aluno-ola">Olá, {primeiroNome(aluno.nome)}</p>
          <div className="atalhos">
            {avulsos > 0 && (
              <a className="botao" href={`/a/${slug}/meus-lances`}>
                Meus lances avulsos
              </a>
            )}
            <form action={sairAlunoAction}>
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="botao">
                Sair
              </button>
            </form>
          </div>
        </div>

        {reservas.length === 0 ? (
          avulsos === 0 && (
            <div className="aviso">
              <p>
                Você ainda não tem lances nesta arena. Peça ao responsável da quadra para incluir você na
                reserva.
              </p>
            </div>
          )
        ) : (
          <>
            <h2 className="so-leitor">Minhas reservas</h2>
            <ul className="reservas">
              {reservas.map((r) => {
                const titulo = tituloReservaNaQuadra(r.inicio, r.fim, r.quadra);
                const dia = textoDia(r.inicio, agora);
                return (
                  <li key={r.id} className="reserva">
                    <div className="reserva-texto">
                      <h3 className="reserva-titulo num-tab">{titulo}</h3>
                      <p className="suave num-tab">{dia}</p>
                    </div>
                    <span className="selo-neutro num-tab">{textoLances(r.lances)}</span>
                    <div className="reserva-acao">
                      <a className="botao botao-cheio" href={`/a/${slug}/r/${r.id}`} aria-label={`Abrir ${titulo} · ${dia}`}>
                        Abrir
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </>
  );
}

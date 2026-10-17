import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lancesAvulsosDoAluno } from "@/app/lib/acesso-aluno";
import { poolCompartilhado } from "@/app/lib/pool";
import { Avatar } from "@/app/componentes/avatar";
import { textoReserva } from "@/app/painel/apresentacao";
import { textoDia, textoLances, tituloReserva } from "./apresentacao";
import { sairAlunoAction } from "./entrar/actions";
import { semR2 } from "./galeria";
import { quadraEAluno } from "./sessao-aluno";

// A lista muda a cada aperto do botão e depende do aluno logado: nada de cache.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const dados = await quadraEAluno(slug);
  return {
    title: dados?.quadra ?? "Quadra não encontrada",
    robots: { index: false, follow: false },
  };
}

// Página aberta pelo QR: as reservas da quadra (horário, primeiro nome e
// quantidade de lances). Os lances só abrem para o aluno logado que está na reserva.
export default async function PaginaDaQuadra({ params }: Props) {
  const { slug } = await params;
  const dados = await quadraEAluno(slug);
  if (!dados) notFound();
  const { aluno } = dados;

  // Só a contagem: o leitor que não assina evita gerar URL que ninguém vai usar.
  const avulsos = aluno ? (await lancesAvulsosDoAluno(poolCompartilhado(), semR2, slug, aluno.alunoId)).length : 0;
  // Dia formatado no servidor, com o relógio dele.
  const agora = new Date();

  return (
    <>
      <header className="faixa">
        <div className="miolo">
          <h1>{dados.quadra}</h1>
          {/* Link comum (não <Link>) para recarregar de verdade, inclusive sem JavaScript. */}
          <a className="botao" href={`/q/${slug}`}>
            Atualizar lista
          </a>
        </div>
      </header>

      <main className="miolo quadra-publica">
        <div className="aluno-barra">
          {aluno ? (
            <>
              <p className="aluno-ola">Olá, {aluno.nome}</p>
              <div className="atalhos">
                {avulsos > 0 && (
                  <a className="botao" href={`/q/${slug}/meus-lances`}>
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
            </>
          ) : (
            <a className="botao" href={`/q/${slug}/entrar`}>
              Entrar
            </a>
          )}
        </div>

        <h2 className="so-leitor">Reservas</h2>
        {dados.reservas.length === 0 ? (
          <div className="aviso">
            <p>Nenhuma reserva com lances nos últimos dias.</p>
          </div>
        ) : (
          <ul className="reservas">
            {dados.reservas.map((r) => {
              const titulo = tituloReserva(r.inicio, r.fim, agora);
              return (
                <li key={r.id} className="reserva">
                  {/* A cor sai do primeiro nome: a página pública não recebe id de aluno. */}
                  <span className="avatares" aria-hidden="true">
                    {r.primeirosNomes.map((nome, i) => (
                      <Avatar key={i} id={nome} nome={nome} />
                    ))}
                  </span>
                  <div className="reserva-texto">
                    <h3 className="reserva-titulo num-tab">{textoReserva(r.inicio, r.fim)}</h3>
                    <p className="suave">
                      <span className="num-tab">{textoDia(r.inicio, agora)}</span> · {r.primeirosNomes.join(", ")}
                    </p>
                  </div>
                  <span className="selo-neutro num-tab">{textoLances(r.lances)}</span>
                  <div className="reserva-acao">
                    {r.minha && aluno ? (
                      <a className="botao botao-cheio" href={`/q/${slug}/r/${r.id}`} aria-label={`Abrir ${titulo}`}>
                        Abrir
                      </a>
                    ) : aluno ? (
                      <span className="cadeado" role="img" aria-label="Reserva de outro aluno">
                        <IconeCadeado />
                      </span>
                    ) : (
                      <a
                        className="cadeado cadeado-link"
                        href={`/q/${slug}/entrar?r=${r.id}`}
                        aria-label={`Entrar para ver ${titulo}`}
                      >
                        <IconeCadeado />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}

function IconeCadeado() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="15.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

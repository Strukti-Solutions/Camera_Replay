import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lancesAvulsosDoAluno, reservasDoAluno } from "@/app/lib/acesso-aluno";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoReserva } from "@/app/painel/apresentacao";
import { primeiroNome, textoDia, textoLances, tituloReserva } from "./apresentacao";
import { sairAlunoAction } from "./entrar/actions";
import { TelaEntrar } from "./entrar/tela";
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

// Página aberta pelo QR. Sem sessão é a tela de entrar da quadra: nenhuma
// reserva, horário ou nome aparece. Com sessão, só as reservas do aluno logado
// e o atalho para os lances avulsos dele.
export default async function PaginaDaQuadra({ params }: Props) {
  const { slug } = await params;
  const dados = await quadraEAluno(slug);
  if (!dados) notFound();
  const { aluno } = dados;
  if (!aluno) return <TelaEntrar slug={slug} quadra={dados.quadra} reserva={null} />;

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
          <h1>{dados.quadra}</h1>
          {/* Link comum (não <Link>) para recarregar de verdade, inclusive sem JavaScript. */}
          <a className="botao" href={`/q/${slug}`}>
            Atualizar lista
          </a>
        </div>
      </header>

      <main className="miolo quadra-publica">
        <div className="aluno-barra">
          <p className="aluno-ola">Olá, {primeiroNome(aluno.nome)}</p>
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
        </div>

        {reservas.length === 0 ? (
          avulsos === 0 && (
            <div className="aviso">
              <p>Você ainda não tem lances nesta quadra.</p>
            </div>
          )
        ) : (
          <>
            <h2 className="so-leitor">Minhas reservas</h2>
            <ul className="reservas">
              {reservas.map((r) => (
                <li key={r.id} className="reserva">
                  <div className="reserva-texto">
                    <h3 className="reserva-titulo num-tab">{textoReserva(r.inicio, r.fim)}</h3>
                    <p className="suave num-tab">{textoDia(r.inicio, agora)}</p>
                  </div>
                  <span className="selo-neutro num-tab">{textoLances(r.lances)}</span>
                  <div className="reserva-acao">
                    <a
                      className="botao botao-cheio"
                      href={`/q/${slug}/r/${r.id}`}
                      aria-label={`Abrir ${tituloReserva(r.inicio, r.fim, agora)}`}
                    >
                      Abrir
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}

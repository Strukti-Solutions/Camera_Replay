import Link from "next/link";
import { textoDeCentavos } from "@/app/lib/precos";
import {
  calendarioDoMes, hrefPasso2, hrefPasso3, nomeDoMes, type EstadoDoDia,
} from "./apresentacao";

// Pedaços do cartão da reserva na página da arena (passos 1 e 2 e o cabeçalho).
// Tudo é link: funciona sem JavaScript.

// "‹ voltar" ao passo anterior e os três tracinhos de progresso.
export function CabecaDoPasso({ passo, voltar }: { passo: 1 | 2 | 3; voltar: { href: string; texto: string } | null }) {
  return (
    <div className="ar-cabeca">
      {voltar ? (
        <Link href={voltar.href} className="ar-voltar">
          ‹ {voltar.texto}
        </Link>
      ) : (
        <span />
      )}
      <span className="ar-progresso" role="img" aria-label={`Passo ${passo} de 3`}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= passo ? "ar-traco ar-traco-feito" : "ar-traco"} />
        ))}
      </span>
    </div>
  );
}

type QuadraDaLista = { id: string; nome: string; esporte: string; aPartirDe: number | null };

export function Passo1({ slug, quadras }: { slug: string; quadras: QuadraDaLista[] }) {
  return (
    <>
      <h2 className="ar-titulo">1. Escolha a quadra</h2>
      {quadras.length === 0 ? (
        <p className="suave">Reservas indisponíveis</p>
      ) : (
        <ul className="ar-quadras">
          {quadras.map((q) => {
            const conteudo = (
              <>
                <span className="ar-quadra-nome">
                  <strong>{q.nome}</strong>
                  {q.esporte && <span>{q.esporte}</span>}
                </span>
                <span className="ar-quadra-preco">
                  {q.aPartirDe === null ? "Reservas indisponíveis" : `a partir de ${textoDeCentavos(q.aPartirDe)}`}
                </span>
              </>
            );
            return (
              <li key={q.id}>
                {q.aPartirDe === null ? (
                  <div className="ar-quadra ar-quadra-off">{conteudo}</div>
                ) : (
                  <Link className="ar-quadra" href={hrefPasso2(slug, q.id)}>
                    {conteudo}
                    <span className="ar-seta" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ROTULO_ESTADO: Record<EstadoDoDia, string> = {
  livre: "horários livres",
  poucos: "poucos horários",
  indisponivel: "indisponível",
};

export function Passo2({
  slug, quadra, mes, meses, agora, livres,
}: {
  slug: string;
  quadra: string;
  mes: string;
  meses: string[];
  agora: Date;
  livres: Map<string, number>;
}) {
  const i = meses.indexOf(mes);
  const anterior = i > 0 ? meses[i - 1] : null;
  const proximo = i < meses.length - 1 ? meses[i + 1] : null;
  const semanas = calendarioDoMes(mes, agora, livres);
  return (
    <>
      <div className="ar-mes">
        <h2 className="ar-titulo">2. Escolha o dia</h2>
        <span className="ar-mes-nav">
          {anterior ? (
            <Link href={hrefPasso2(slug, quadra, anterior)} aria-label="Mês anterior">
              ‹
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <strong>{nomeDoMes(mes)}</strong>
          {proximo ? (
            <Link href={hrefPasso2(slug, quadra, proximo)} aria-label="Próximo mês">
              ›
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </span>
      </div>
      <table className="ar-calendario">
        <thead>
          <tr>
            {SEMANA.map((s) => (
              <th key={s} scope="col">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((semana) => (
            <tr key={semana[0].dia}>
              {semana.map((d) => (
                <td key={d.dia} className={d.doMes ? `ar-dia ar-dia-${d.estado}` : "ar-dia ar-dia-fora"}>
                  {d.doMes && d.estado !== "indisponivel" ? (
                    <Link href={hrefPasso3(slug, quadra, d.dia)} aria-label={`${d.numero}, ${ROTULO_ESTADO[d.estado]}`}>
                      {d.numero}
                    </Link>
                  ) : (
                    <span aria-hidden={d.doMes ? undefined : true}>
                      {d.numero}
                      {d.doMes && <span className="so-leitor">, indisponível</span>}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ar-legenda">
        <span>
          <i className="ar-dia-livre" /> livre
        </span>
        <span>
          <i className="ar-dia-poucos" /> poucos horários
        </span>
        <span>
          <i className="ar-dia-indisponivel" /> indisponível
        </span>
      </p>
    </>
  );
}

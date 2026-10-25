import { escolhaDeHorarios, horariosDoDia, type Periodo } from "@/app/lib/disponibilidade";
import { grupoDoDia, textoMinutos, type HorarioComId } from "@/app/lib/horarios";
import { textoDeCentavos } from "@/app/lib/precos";
import { acaoDoHorario, diaPorExtenso, hrefDoHorario, hrefReservar } from "./apresentacao";

type Quadra = { id: string; nome: string; esporte: string; horarios: HorarioComId[] };

const GRUPOS = ["madrugada e manhã", "tarde", "noite"] as const;
const TITULO_GRUPO: Record<(typeof GRUPOS)[number], string> = {
  "madrugada e manhã": "Madrugada e manhã",
  tarde: "Tarde",
  noite: "Noite",
};

const intervalo = (h: { inicio: number; fim: number }) => `${textoMinutos(h.inicio)}–${textoMinutos(h.fim)}`;

// Passo 3 da reserva: os horários do dono no dia escolhido, em caixinhas.
// Tocar numa caixinha livre é um link (marca, soma um horário seguido ou tira),
// então tudo funciona sem JavaScript.
export function EscolhaDaQuadra({
  slug,
  quadra,
  dia,
  inicio,
  qtd,
  agora,
  ocupados,
}: {
  slug: string;
  quadra: Quadra;
  dia: string;
  inicio: number | null;
  qtd: number;
  agora: Date;
  // Períodos do dia já tomados por reserva ou bloqueio: aparecem como "Ocupado" para todos.
  ocupados: Periodo[];
}) {
  const doDia = horariosDoDia(quadra.horarios, dia, agora, ocupados);
  // Seleção que não fecha mais (URL velha ou horário tomado): conta como não escolhida.
  const escolha = inicio === null ? null : escolhaDeHorarios(quadra.horarios, dia, inicio, qtd, agora, ocupados);
  const escolhidos = new Set(escolha?.itens.map((i) => i.inicio));
  const selecao = escolha ? { inicio: escolha.inicio, qtd: escolha.itens.length } : null;
  const base = { slug, quadra: quadra.id, dia };
  const algumLivre = doDia.some((x) => x.livre);
  const podeSomar = selecao !== null && doDia.some((x, i) => x.livre && acaoDoHorario(doDia, selecao, i) === "somar");

  return (
    <div className="quadra-escolha">
      <h2 className="ar-titulo">3. Escolha os horários</h2>
      {algumLivre ? (
        <p className="suave pj-dica">
          {podeSomar
            ? "Quer jogar mais? Toque no próximo horário (+) para somar."
            : "Dá para escolher mais de um horário seguido: toque um depois do outro."}
        </p>
      ) : (
        <p className="quadra-sem-horario">Sem horários livres neste dia.</p>
      )}

      {GRUPOS.map((g) => {
        const itens = doDia.map((x, i) => ({ ...x, i })).filter((x) => grupoDoDia(x.horario.inicio) === g);
        if (itens.length === 0) return null;
        return (
          <section key={g} className="pj-grupo" aria-label={TITULO_GRUPO[g]}>
            <h3>{TITULO_GRUPO[g]}</h3>
            <ul className="pj-slots">
              {itens.map(({ horario, livre, i }) => {
                if (!livre) {
                  return (
                    <li key={horario.id} className="pj-slot pj-slot-ocupado">
                      <strong>{intervalo(horario)}</strong>
                      <span>Ocupado</span>
                    </li>
                  );
                }
                const marcado = escolhidos.has(horario.inicio);
                const somar = !marcado && acaoDoHorario(doDia, selecao, i) === "somar";
                const classe = marcado ? "pj-slot pj-slot-escolhido" : somar ? "pj-slot pj-slot-somar" : "pj-slot";
                return (
                  <li key={horario.id} className="pj-slot-item">
                    <a className={classe} href={hrefDoHorario(base, doDia, selecao, i)} aria-current={marcado ? "true" : undefined}>
                      {/* Bolinha de marcar: vazia, com ✓ (escolhido) ou + (soma ao fim da seleção). */}
                      <i className="pj-marca" aria-hidden="true">
                        {marcado ? "✓" : somar ? "+" : ""}
                      </i>
                      <strong>{intervalo(horario)}</strong>
                      <span>{textoDeCentavos(horario.precoCentavos)}</span>
                      {marcado && <em>Escolhido</em>}
                      {somar && <em>Somar</em>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {escolha && (
        <div className="ar-resumo">
          <div className="ar-resumo-linhas">
            <p>
              <span>
                {quadra.nome} · {diaPorExtenso(dia)}
              </span>
              <strong>
                {textoMinutos(escolha.inicio)} às {textoMinutos(escolha.fim)}
              </strong>
            </p>
            <p>
              <span className="suave">Pagamento na arena · cancelamento grátis até 24 h antes</span>
              <strong>{textoDeCentavos(escolha.totalCentavos)}</strong>
            </p>
          </div>
          <a
            href={hrefReservar({ quadra: quadra.id, dia, inicio: escolha.inicio, qtd: escolha.itens.length })}
            className="botao botao-cheio quadra-reservar"
          >
            Reservar
          </a>
        </div>
      )}
    </div>
  );
}

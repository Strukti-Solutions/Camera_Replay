import { diasDisponiveis, escolhaDeHorarios, horariosDoDia, type Periodo } from "@/app/lib/disponibilidade";
import { grupoDoDia, textoMinutos, type HorarioComId } from "@/app/lib/horarios";
import { textoDeCentavos } from "@/app/lib/precos";
import { hrefDoHorario, hrefReservar } from "./apresentacao";

type Quadra = { id: string; nome: string; esporte: string; horarios: HorarioComId[] };

const GRUPOS = ["madrugada e manhã", "tarde", "noite"] as const;
const TITULO_GRUPO: Record<(typeof GRUPOS)[number], string> = {
  "madrugada e manhã": "Madrugada e manhã",
  tarde: "Tarde",
  noite: "Noite",
};

const intervalo = (h: { inicio: number; fim: number }) => `${textoMinutos(h.inicio)}–${textoMinutos(h.fim)}`;

// Formulário GET de uma quadra: o dia vai na URL e o servidor devolve os
// horários do dono em caixinhas. Tocar numa caixinha livre é um link (marca,
// soma um horário seguido ou tira), então tudo funciona sem JavaScript.
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
  if (quadra.horarios.length === 0) {
    return <p className="suave">Reservas indisponíveis</p>;
  }

  const doDia = horariosDoDia(quadra.horarios, dia, agora, ocupados);
  // Seleção que não fecha mais (URL velha ou horário tomado): conta como não escolhida.
  const escolha = inicio === null ? null : escolhaDeHorarios(quadra.horarios, dia, inicio, qtd, agora, ocupados);
  const escolhidos = new Set(escolha?.itens.map((i) => i.inicio));
  const selecao = escolha ? { inicio: escolha.inicio, qtd: escolha.itens.length } : null;
  const base = { slug, quadra: quadra.id, dia };
  const algumLivre = doDia.some((x) => x.livre);

  return (
    <div className="quadra-escolha">
      <form action={`/a/${slug}#quadra-${quadra.id}`} method="get" className="quadra-dia">
        <input type="hidden" name="quadra" value={quadra.id} />
        <div className="campo">
          <label htmlFor={`dia-${quadra.id}`}>Dia</label>
          <select id={`dia-${quadra.id}`} name="dia" defaultValue={dia}>
            {diasDisponiveis(agora).map((d) => (
              <option key={d.valor} value={d.valor}>
                {d.rotulo}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="botao">
          Ver horários
        </button>
      </form>

      {!algumLivre && <p className="quadra-sem-horario">Sem horários livres neste dia.</p>}

      {GRUPOS.map((g) => {
        const itens = doDia.map((x, i) => ({ ...x, i })).filter((x) => grupoDoDia(x.horario.inicio) === g);
        if (itens.length === 0) return null;
        return (
          <section key={g} className="pj-grupo" aria-label={TITULO_GRUPO[g]}>
            <h3>{TITULO_GRUPO[g]}</h3>
            <ul className="pj-slots">
              {itens.map(({ horario, livre, i }) => {
                const conteudo = (
                  <>
                    <strong>{intervalo(horario)}</strong>
                    <span>{textoDeCentavos(horario.precoCentavos)}</span>
                  </>
                );
                if (!livre) {
                  return (
                    <li key={horario.id} className="pj-slot pj-slot-ocupado">
                      <strong>{intervalo(horario)}</strong>
                      <span>Ocupado</span>
                    </li>
                  );
                }
                const marcado = escolhidos.has(horario.inicio);
                return (
                  <li key={horario.id} className="pj-slot-item">
                    <a
                      className={marcado ? "pj-slot pj-slot-escolhido" : "pj-slot"}
                      href={hrefDoHorario(base, doDia, selecao, i)}
                      aria-current={marcado ? "true" : undefined}
                    >
                      {conteudo}
                      {marcado && <em>Escolhido</em>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {doDia.length > 0 && <p className="suave pj-dica">Quer mais tempo? Escolha horários seguidos.</p>}

      {escolha && (
        <div className="quadra-preco">
          <p className="quadra-total">
            {textoMinutos(escolha.inicio)} às {textoMinutos(escolha.fim)} · <strong>{textoDeCentavos(escolha.totalCentavos)}</strong>
          </p>
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

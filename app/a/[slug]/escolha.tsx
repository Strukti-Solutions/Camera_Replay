import { diasDisponiveis, iniciosLivres, precoEscolha } from "@/app/lib/disponibilidade";
import { textoDeCentavos, textoHora, type Faixa } from "@/app/lib/precos";
import { hrefReservar } from "./apresentacao";

type Quadra = { id: string; nome: string; esporte: string; faixas: Faixa[] };

const textoHoras = (n: number) => (n === 1 ? "1 hora" : `${n} horas`);

// Formulário GET de uma quadra: dia, início e duração vão na URL e o servidor
// devolve os horários livres e o preço. Funciona sem JavaScript (depois de
// trocar o dia ou o início, é preciso tocar em "Ver preço").
export function EscolhaDaQuadra({
  slug,
  quadra,
  dia,
  inicio,
  horas,
  agora,
  ocupadas,
}: {
  slug: string;
  quadra: Quadra;
  dia: string;
  inicio: number | null;
  horas: number;
  agora: Date;
  // Horas do dia já tomadas por reserva ou bloqueio: somem para todos.
  ocupadas: Set<number>;
}) {
  if (quadra.faixas.length === 0) {
    return <p className="suave">Reservas indisponíveis</p>;
  }

  const inicios = iniciosLivres(quadra.faixas, dia, agora, ocupadas);
  // Início fora da lista do dia (URL velha): conta como não escolhido.
  const escolhido = inicios.find((i) => i.hora === inicio) ?? null;
  const duracao = escolhido ? Math.min(horas, escolhido.horasMax) : 1;
  // Duração acima do que cabe: o total é o da duração reduzida, e o jogador fica sabendo.
  const reduzida = escolhido !== null && horas > escolhido.horasMax;
  const preco = escolhido ? precoEscolha(quadra.faixas, dia, escolhido.hora, duracao, agora, ocupadas) : null;
  const variosPrecos = preco ? new Set(preco.porHora.map((h) => h.precoCentavos)).size > 1 : false;
  const id = (campo: string) => `${campo}-${quadra.id}`;

  return (
    <form action={`/a/${slug}#quadra-${quadra.id}`} method="get" className="quadra-escolha">
      <input type="hidden" name="quadra" value={quadra.id} />
      <div className="campo">
        <label htmlFor={id("dia")}>Dia</label>
        <select id={id("dia")} name="dia" defaultValue={dia}>
          {diasDisponiveis(agora).map((d) => (
            <option key={d.valor} value={d.valor}>
              {d.rotulo}
            </option>
          ))}
        </select>
      </div>

      {inicios.length === 0 ? (
        <p className="quadra-sem-horario">Sem horários livres neste dia.</p>
      ) : (
        <div className="quadra-campos">
          <div className="campo">
            <label htmlFor={id("inicio")}>Início</label>
            <select id={id("inicio")} name="inicio" defaultValue={escolhido ? String(escolhido.hora) : ""}>
              <option value="">Escolha</option>
              {inicios.map((i) => {
                const valor = precoEscolha(quadra.faixas, dia, i.hora, 1, agora, ocupadas)?.totalCentavos;
                return (
                  <option key={i.hora} value={i.hora}>
                    {valor === undefined ? textoHora(i.hora) : `${textoHora(i.hora)} · ${textoDeCentavos(valor)}`}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="campo">
            <label htmlFor={id("horas")}>Duração</label>
            <select id={id("horas")} name="horas" defaultValue={String(duracao)}>
              {Array.from({ length: escolhido ? escolhido.horasMax : 1 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {textoHoras(n)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <button type="submit" className="botao">
        Ver preço
      </button>

      {preco && (
        <div className="quadra-preco">
          <p className="quadra-total">
            Total: <strong>{textoDeCentavos(preco.totalCentavos)}</strong>
          </p>
          {reduzida && <p className="quadra-reduzida">Duração reduzida para {duracao} h.</p>}
          {variosPrecos && (
            <p className="suave">
              {preco.porHora.map((h) => `${textoHora(h.hora)} ${textoDeCentavos(h.precoCentavos)}`).join(" · ")}
            </p>
          )}
          <a
            href={hrefReservar({ quadra: quadra.id, dia, inicio: preco.hora, horas: preco.horas })}
            className="botao botao-cheio quadra-reservar"
          >
            Reservar
          </a>
        </div>
      )}
    </form>
  );
}

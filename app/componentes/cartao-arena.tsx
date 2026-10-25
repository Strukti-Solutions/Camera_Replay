import { textoAPartirDe } from "@/app/escolha-arena";
import type { CartaoArena } from "@/app/lib/arenas-publicas";
import { FaixaDeFotos } from "./faixa-de-fotos";

// Card de uma arena na home. O nome é o link; o resto do card (menos a faixa
// de fotos, que precisa rolar) também leva à arena. `data-arena` liga o card ao
// pino do mapa.
export function CartaoDaArena({ arena }: { arena: CartaoArena }) {
  const href = `/a/${encodeURIComponent(arena.slug)}`;
  const local = arena.bairro ?? arena.cidade;
  return (
    <li className="hm-cartao" data-arena={arena.slug}>
      <FaixaDeFotos fotos={arena.fotos} nome={arena.nome} />
      <div className="hm-info">
        <h3>
          <a className="hm-link" href={href}>
            {arena.nome}
          </a>
        </h3>
        {local && <p className="hm-local">{local}</p>}
        <p className={arena.aPartirDe === null ? "hm-preco hm-preco-off" : "hm-preco"}>{textoAPartirDe(arena)}</p>
        {arena.esportes.length > 0 && (
          <ul className="hm-chips" aria-label="Esportes">
            {arena.esportes.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

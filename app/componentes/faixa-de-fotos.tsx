"use client";

import { useRef, useState } from "react";

// Fotos do card da arena numa faixa que rola de lado (deslizar no celular,
// barra de rolagem ou Shift+roda no computador). As bolinhas acompanham a foto
// à mostra. Sem JavaScript a faixa rola do mesmo jeito; só as bolinhas param.
export function FaixaDeFotos({ fotos, nome }: { fotos: string[]; nome: string }) {
  const [atual, setAtual] = useState(0);
  const faixa = useRef<HTMLDivElement>(null);

  if (fotos.length === 0) return <div className="hm-sem-foto">{nome}</div>;
  return (
    <div className="hm-fotos">
      <div
        ref={faixa}
        className="hm-faixa"
        onScroll={() => {
          const f = faixa.current;
          if (f && f.clientWidth > 0) setAtual(Math.round(f.scrollLeft / f.clientWidth));
        }}
      >
        {fotos.map((id, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- rota própria, já com cache
          <img key={id} src={`/fotos/${id}`} alt={i === 0 ? `Foto da ${nome}` : ""} loading="lazy" />
        ))}
      </div>
      {fotos.length > 1 && (
        <span className="hm-bolinhas" aria-hidden="true">
          {fotos.map((id, i) => (
            <i key={id} className={i === atual ? "hm-bolinha-atual" : undefined} />
          ))}
        </span>
      )}
    </div>
  );
}

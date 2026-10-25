"use client";

import { useEffect, useState } from "react";

const INTERVALO_MS = 5000;

// Fotos da arena passando sozinhas, com bolinhas. Param com o mouse em cima,
// com o foco dentro e com "menos movimento"; sem JavaScript fica a primeira.
export function FotosDaArena({ fotos, nome }: { fotos: string[]; nome: string }) {
  const [atual, setAtual] = useState(0);
  const [parado, setParado] = useState(false);

  useEffect(() => {
    if (fotos.length < 2 || parado) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setAtual((i) => (i + 1) % fotos.length), INTERVALO_MS);
    return () => window.clearInterval(t);
  }, [fotos.length, parado]);

  return (
    <div
      className="ar-fotos"
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
      onFocus={() => setParado(true)}
      onBlur={() => setParado(false)}
    >
      {fotos.map((id, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- rota própria, já com cache
        <img
          key={id}
          src={`/fotos/${id}`}
          alt={`Foto ${i + 1} de ${fotos.length} da ${nome}`}
          className={i === atual ? "ar-foto ar-foto-atual" : "ar-foto"}
          aria-hidden={i === atual ? undefined : true}
          loading={i === 0 ? "eager" : "lazy"}
        />
      ))}
      {fotos.length > 1 && (
        <div className="ar-bolinhas">
          {fotos.map((id, i) => (
            <button
              key={id}
              type="button"
              aria-label={`Mostrar foto ${i + 1} de ${fotos.length}`}
              aria-current={i === atual ? "true" : undefined}
              onClick={() => setAtual(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

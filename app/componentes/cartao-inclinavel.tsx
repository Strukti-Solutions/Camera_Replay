"use client";

import { useRef, type ReactNode } from "react";

// Cartão (li) que inclina na direção do mouse ou do dedo e move o brilho do
// vidro da foto (--mx/--my). Só CSS vars: com "menos movimento" o CSS ignora.
export function CartaoInclinavel({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);

  function seguir(e: React.PointerEvent<HTMLLIElement>) {
    const el = ref.current;
    if (!el) return;
    const caixa = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - caixa.left) / caixa.width));
    const y = Math.min(1, Math.max(0, (e.clientY - caixa.top) / caixa.height));
    el.style.setProperty("--ry", `${((x - 0.5) * 8).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${((0.5 - y) * 6).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    el.dataset.ativo = "";
  }

  function soltar() {
    const el = ref.current;
    if (!el) return;
    for (const v of ["--rx", "--ry", "--mx", "--my"]) el.style.removeProperty(v);
    delete el.dataset.ativo;
  }

  return (
    <li
      ref={ref}
      className={className}
      onPointerMove={seguir}
      onPointerDown={seguir}
      onPointerUp={(e) => e.pointerType !== "mouse" && soltar()}
      onPointerLeave={soltar}
      onPointerCancel={soltar}
    >
      {children}
    </li>
  );
}

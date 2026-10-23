import Link from "next/link";

// Link "← Voltar" das telas de entrar. Link comum, e não history.back(): funciona
// sem JavaScript e quando a pessoa chegou direto pelo QR, sem página anterior.
export function LinkVoltar({ href }: { href: string }) {
  return (
    <p className="voltar">
      <Link href={href}>
        <span aria-hidden="true">←</span> Voltar
      </Link>
    </p>
  );
}

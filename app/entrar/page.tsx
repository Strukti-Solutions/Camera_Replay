import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/app/painel/sessao-atual";
import { FormularioEntrar } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

export default async function PaginaEntrar() {
  if (await sessaoAtual()) redirect("/painel");
  return (
    <main className="miolo entrar">
      <h1>Entrar</h1>
      <FormularioEntrar />
    </main>
  );
}

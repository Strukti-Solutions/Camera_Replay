import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CabecalhoAdmin } from "@/app/admin/cabecalho";
import { sessaoAdminAtual } from "@/app/admin/sessao-admin-atual";
import { FormularioEntrarAdmin } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar na administração",
  robots: { index: false, follow: false },
};

export default async function PaginaEntrarAdmin() {
  if (await sessaoAdminAtual()) redirect("/admin");
  return (
    <>
      <CabecalhoAdmin comSair={false} />
      <main className="miolo entrar">
        <h1>Entrar</h1>
        <FormularioEntrarAdmin />
      </main>
    </>
  );
}

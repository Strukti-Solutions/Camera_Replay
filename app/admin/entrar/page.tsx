import { redirect } from "next/navigation";
import { sessaoAdminAtual } from "@/app/admin/sessao-admin-atual";

export const dynamic = "force-dynamic";

// O login do admin agora é o único, em /entrar. Esta rota fica só para os links
// antigos; como o cookie do admin (path /admin) chega aqui, quem já está logado
// vai direto para /admin.
export default async function PaginaEntrarAdmin() {
  if (await sessaoAdminAtual()) redirect("/admin");
  redirect("/entrar");
}

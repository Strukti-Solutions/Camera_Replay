import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { poolCompartilhado } from "@/app/lib/pool";
import { validarSessaoAdmin, type SessaoAdmin } from "@/app/lib/sessao-admin";

// Cookie próprio do super admin: nunca o de dono (replay_sessao) nem o de aluno.
// Path /admin: o navegador só o manda para as páginas e actions daqui.
export const COOKIE_ADMIN = "replay_admin";
export const CAMINHO_COOKIE_ADMIN = "/admin";

export async function sessaoAdminAtual(): Promise<SessaoAdmin | null> {
  const token = (await cookies()).get(COOKIE_ADMIN)?.value;
  if (!token) return null;
  return validarSessaoAdmin(poolCompartilhado(), token);
}

// Toda página e toda action de /admin chamam isto antes de tocar em plataforma.ts.
export async function exigirSuperAdmin(): Promise<SessaoAdmin> {
  const sessao = await sessaoAdminAtual();
  if (!sessao) redirect("/admin/entrar");
  return sessao;
}

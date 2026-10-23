import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { poolCompartilhado } from "@/app/lib/pool";
import { COOKIE_ADMIN, validarSessaoAdmin, type SessaoAdmin } from "@/app/lib/sessao-admin";

// O cookie (replay_admin, path /admin) é definido em app/lib/sessao-admin.ts,
// porque o login único em /entrar também o grava.

export async function sessaoAdminAtual(): Promise<SessaoAdmin | null> {
  const token = (await cookies()).get(COOKIE_ADMIN)?.value;
  if (!token) return null;
  return validarSessaoAdmin(poolCompartilhado(), token);
}

// Toda página e toda action de /admin chamam isto antes de tocar em plataforma.ts.
export async function exigirSuperAdmin(): Promise<SessaoAdmin> {
  const sessao = await sessaoAdminAtual();
  if (!sessao) redirect("/entrar");
  return sessao;
}

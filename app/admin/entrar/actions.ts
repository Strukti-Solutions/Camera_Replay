"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ipDoCliente } from "@/app/entrar/ip";
import { poolCompartilhado } from "@/app/lib/pool";
import { DURACAO_SESSAO_ADMIN_S, entrarAdmin, sairAdmin } from "@/app/lib/sessao-admin";
import { CAMINHO_COOKIE_ADMIN, COOKIE_ADMIN } from "@/app/admin/sessao-admin-atual";

// O e-mail volta para o campo depois de um erro; a senha nunca.
export type EstadoEntrarAdmin = { erro: string | null; email: string };

export async function entrarAdminAction(_estado: EstadoEntrarAdmin, form: FormData): Promise<EstadoEntrarAdmin> {
  const email = String(form.get("email") ?? "").trim();
  const senha = String(form.get("senha") ?? "");
  const ip = ipDoCliente(await headers());

  const r = await entrarAdmin(poolCompartilhado(), email, senha, ip);
  if (!r.ok) {
    return {
      email,
      erro:
        r.motivo === "bloqueado"
          ? "Muitas tentativas. Espere 15 minutos e tente de novo."
          : "E-mail ou senha incorretos.",
    };
  }

  (await cookies()).set(COOKIE_ADMIN, r.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: CAMINHO_COOKIE_ADMIN,
    maxAge: DURACAO_SESSAO_ADMIN_S,
  });
  redirect("/admin");
}

export async function sairAdminAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_ADMIN)?.value;
  if (token) await sairAdmin(poolCompartilhado(), token);
  jar.delete({ name: COOKIE_ADMIN, path: CAMINHO_COOKIE_ADMIN });
  redirect("/admin/entrar");
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { poolCompartilhado } from "@/app/lib/pool";
import { CAMINHO_COOKIE_ADMIN, COOKIE_ADMIN, sairAdmin } from "@/app/lib/sessao-admin";

// O login do admin é o único (/entrar); aqui fica só a saída.
export async function sairAdminAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_ADMIN)?.value;
  if (token) await sairAdmin(poolCompartilhado(), token);
  jar.delete({ name: COOKIE_ADMIN, path: CAMINHO_COOKIE_ADMIN });
  redirect("/entrar");
}

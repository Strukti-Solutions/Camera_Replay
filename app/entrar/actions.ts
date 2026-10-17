"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { poolCompartilhado } from "@/app/lib/pool";
import { DURACAO_SESSAO_S, entrar, sair } from "@/app/lib/sessao";
import { COOKIE_SESSAO } from "@/app/painel/sessao-atual";
import { ipDoCliente } from "./ip";

export type EstadoEntrar = { erro: string | null };

export async function entrarAction(_estado: EstadoEntrar, form: FormData): Promise<EstadoEntrar> {
  const email = String(form.get("email") ?? "");
  const senha = String(form.get("senha") ?? "");
  const ip = ipDoCliente(await headers());

  const r = await entrar(poolCompartilhado(), email, senha, ip);
  if (!r.ok) {
    return {
      erro:
        r.motivo === "bloqueado"
          ? "Muitas tentativas. Espere 15 minutos e tente de novo."
          : "E-mail ou senha incorretos.",
    };
  }

  (await cookies()).set(COOKIE_SESSAO, r.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_SESSAO_S,
  });
  redirect("/painel");
}

export async function sairAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (token) await sair(poolCompartilhado(), token);
  jar.delete(COOKIE_SESSAO);
  redirect("/entrar");
}

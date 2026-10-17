"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { entrarAluno, sairAluno } from "@/app/lib/acesso-aluno";
import { poolCompartilhado } from "@/app/lib/pool";
import { DURACAO_SESSAO_S } from "@/app/lib/sessao";
import { ipDoCliente } from "@/app/entrar/ip";
import { destinoAposEntrar } from "../apresentacao";
import { COOKIE_ALUNO } from "../sessao-aluno";

export type EstadoEntrarAluno = { erro: string | null; email: string };

// Mesmas mensagens do login do dono. O e-mail volta ao formulário; a senha nunca.
export async function entrarAlunoAction(_estado: EstadoEntrarAluno, form: FormData): Promise<EstadoEntrarAluno> {
  const slug = String(form.get("slug") ?? "");
  const reserva = String(form.get("r") ?? "");
  const email = String(form.get("email") ?? "").trim();
  const senha = String(form.get("senha") ?? "");
  const ip = ipDoCliente(await headers());

  // A arena vem do slug: com slug desconhecido a resposta é a mesma de senha errada.
  const r = await entrarAluno(poolCompartilhado(), slug, email, senha, ip);
  const destino = destinoAposEntrar(slug, reserva);
  if (!r.ok || !destino) {
    return {
      email,
      erro:
        r.ok === false && r.motivo === "bloqueado"
          ? "Muitas tentativas. Espere 15 minutos e tente de novo."
          : "E-mail ou senha incorretos.",
    };
  }

  (await cookies()).set(COOKIE_ALUNO, r.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_SESSAO_S,
  });
  redirect(destino);
}

export async function sairAlunoAction(form: FormData): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_ALUNO)?.value;
  if (token) await sairAluno(poolCompartilhado(), token);
  jar.delete(COOKIE_ALUNO);
  redirect(destinoAposEntrar(String(form.get("slug") ?? ""), null) ?? "/");
}

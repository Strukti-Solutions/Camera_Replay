"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { ipDoCliente } from "@/app/entrar/ip";
import { criarEnvioEmail, type EnviarEmail } from "@/app/lib/email";
import { poolCompartilhado } from "@/app/lib/pool";
import { pedirRecuperacao } from "@/app/lib/recuperar-senha";

export type EstadoEsqueci = { ok: string | null; email: string };

// A mesma frase para qualquer e-mail: com conta ou sem, bloqueado ou não.
const FRASE = "Se o e-mail tiver conta, enviamos um link para redefinir a senha. Ele vale por 1 hora.";

function urlDoApp(): string | null {
  const configurada = process.env.APP_URL?.trim();
  if (configurada) return configurada;
  // Nunca o Host da requisição: quem pede escolheria o domínio do link.
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
}

export async function esqueciAction(_estado: EstadoEsqueci, form: FormData): Promise<EstadoEsqueci> {
  const email = String(form.get("email") ?? "").trim().slice(0, 254);
  const ip = ipDoCliente(await headers());
  const appUrl = urlDoApp();
  if (!appUrl) {
    console.error("esqueci a senha: APP_URL não configurado");
    return { ok: FRASE, email };
  }

  // O envio de verdade roda depois da resposta (after): esperar por ele deixaria
  // a resposta mais lenta só para quem tem conta. O erro vai para o log sem o
  // link e sem o e-mail.
  const envio = criarEnvioEmail();
  const enviar: EnviarEmail = async (m) => {
    after(async () => {
      try {
        await envio(m);
      } catch (e) {
        console.error("esqueci a senha: falha ao enviar o e-mail:", e instanceof Error ? e.message : "erro desconhecido");
      }
    });
  };
  await pedirRecuperacao(poolCompartilhado(), email, ip, appUrl, enviar);
  return { ok: FRASE, email };
}

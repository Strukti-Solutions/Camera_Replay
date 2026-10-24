"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { ipDoCliente } from "@/app/entrar/ip";
import { criarEnvioEmail } from "@/app/lib/email";
import { poolCompartilhado } from "@/app/lib/pool";
import { enviarLink, limitarPedido } from "@/app/lib/recuperar-senha";

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

  // Só o limite de tentativas roda antes da resposta. Achar a conta, gravar o
  // token e enviar vão para depois dela (after): o tempo da resposta é o mesmo
  // para quem tem conta e para quem não tem. Os erros vão para o log sem o link
  // e sem o e-mail; a tela mostra a mesma frase de qualquer jeito.
  const db = poolCompartilhado();
  let emailNorm: string | null;
  try {
    emailNorm = await limitarPedido(db, email, ip);
  } catch {
    console.error("esqueci a senha: falha no banco ao registrar o pedido");
    return { ok: FRASE, email };
  }
  if (emailNorm !== null) {
    const alvo = emailNorm;
    after(async () => {
      try {
        await enviarLink(db, alvo, appUrl, criarEnvioEmail());
      } catch (e) {
        // Só o código do Postgres ou a mensagem do email.ts ("e-mail: ..."), que
        // não levam link nem endereço.
        const codigo = (e as { code?: string }).code;
        const msg = e instanceof Error && e.message.startsWith("e-mail:") ? e.message : "";
        console.error("esqueci a senha: falha ao gerar ou enviar o link", codigo ? `(código ${codigo})` : msg);
      }
    });
  }
  return { ok: FRASE, email };
}

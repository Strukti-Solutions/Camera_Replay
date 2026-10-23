"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { caminhoSeguro, destinoDoTipo, entrarUnico, type TipoConta } from "@/app/lib/entrar-unico";
import { DURACAO_SESSAO_JOGADOR_S, sairJogador } from "@/app/lib/jogadores";
import { poolCompartilhado } from "@/app/lib/pool";
import { DURACAO_SESSAO_S, sair } from "@/app/lib/sessao";
import { CAMINHO_COOKIE_ADMIN, COOKIE_ADMIN, DURACAO_SESSAO_ADMIN_S, sairAdmin } from "@/app/lib/sessao-admin";
import { COOKIE_JOGADOR } from "@/app/jogador/sessao-jogador";
import { COOKIE_SESSAO } from "@/app/painel/sessao-atual";
import { ipDoCliente } from "./ip";
import { mensagemDeEntrar } from "./mensagens";

// O e-mail volta para o campo depois de um erro; a senha nunca.
export type EstadoEntrar = { erro: string | null; email: string };

type Cookies = Awaited<ReturnType<typeof cookies>>;

// Encerra no navegador as sessões dos tipos que não são o que acabou de entrar
// (aparelho compartilhado: o cookie de 30 dias do jogador não pode continuar
// valendo depois que o dono entra, por exemplo). Apaga a linha no banco quando o
// cookie chega aqui e sempre apaga o cookie. O do admin (path /admin) não é
// mandado para /entrar: só o cookie é apagado, e a linha vence sozinha em 12 h.
async function encerrarOutrasSessoes(jar: Cookies, tipo: TipoConta): Promise<void> {
  const db = poolCompartilhado();
  if (tipo !== "dono") {
    const t = jar.get(COOKIE_SESSAO)?.value;
    if (t) await sair(db, t);
    jar.delete(COOKIE_SESSAO);
  }
  if (tipo !== "jogador") {
    const t = jar.get(COOKIE_JOGADOR)?.value;
    if (t) await sairJogador(db, t);
    jar.delete(COOKIE_JOGADOR);
  }
  if (tipo !== "admin") {
    const t = jar.get(COOKIE_ADMIN)?.value;
    if (t) await sairAdmin(db, t);
    jar.delete({ name: COOKIE_ADMIN, path: CAMINHO_COOKIE_ADMIN });
  }
}

export async function entrarAction(_estado: EstadoEntrar, form: FormData): Promise<EstadoEntrar> {
  const email = String(form.get("email") ?? "").trim();
  const senha = String(form.get("senha") ?? "");
  const ip = ipDoCliente(await headers());

  const r = await entrarUnico(poolCompartilhado(), email, senha, ip);
  if (!r.ok) {
    return { email, erro: mensagemDeEntrar(r.motivo) };
  }

  const seguro = process.env.NODE_ENV === "production";
  const jar = await cookies();
  await encerrarOutrasSessoes(jar, r.tipo);
  if (r.tipo === "admin") {
    // Path /admin e SameSite Strict: o cookie do admin só viaja para /admin.
    jar.set(COOKIE_ADMIN, r.token, {
      httpOnly: true, secure: seguro, sameSite: "strict", path: CAMINHO_COOKIE_ADMIN, maxAge: DURACAO_SESSAO_ADMIN_S,
    });
  } else if (r.tipo === "dono") {
    jar.set(COOKIE_SESSAO, r.token, {
      httpOnly: true, secure: seguro, sameSite: "lax", path: "/", maxAge: DURACAO_SESSAO_S,
    });
  } else {
    jar.set(COOKIE_JOGADOR, r.token, {
      httpOnly: true, secure: seguro, sameSite: "lax", path: "/", maxAge: DURACAO_SESSAO_JOGADOR_S,
    });
  }
  // Só o jogador volta para onde estava; dono e admin vão sempre para a área deles.
  const voltar = r.tipo === "jogador" ? caminhoSeguro(form.get("voltar")) : null;
  redirect(voltar ?? destinoDoTipo(r.tipo));
}

// Saída do dono (botão do painel).
export async function sairAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (token) await sair(poolCompartilhado(), token);
  jar.delete(COOKIE_SESSAO);
  redirect("/entrar");
}

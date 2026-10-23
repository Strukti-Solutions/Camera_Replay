import type { cookies } from "next/headers";
import { type TipoConta } from "@/app/lib/entrar-unico";
import { sairJogador } from "@/app/lib/jogadores";
import { poolCompartilhado } from "@/app/lib/pool";
import { sair } from "@/app/lib/sessao";
import { CAMINHO_COOKIE_ADMIN, COOKIE_ADMIN, sairAdmin } from "@/app/lib/sessao-admin";
import { COOKIE_JOGADOR } from "@/app/jogador/sessao-jogador";
import { COOKIE_SESSAO } from "@/app/painel/sessao-atual";

type Cookies = Awaited<ReturnType<typeof cookies>>;

// Encerra no navegador as sessões dos tipos que não são o que acabou de entrar
// (aparelho compartilhado: o cookie de 30 dias do jogador não pode continuar
// valendo depois que o dono entra, por exemplo). Apaga a linha no banco quando o
// cookie chega aqui e sempre apaga o cookie. O do admin (path /admin) não é
// mandado para /entrar: só o cookie é apagado, e a linha vence sozinha em 12 h.
export async function encerrarOutrasSessoes(jar: Cookies, tipo: TipoConta): Promise<void> {
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

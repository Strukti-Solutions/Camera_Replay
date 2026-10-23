import type { Db } from "./db";
import { criarContaJogador, type ResultadoCriarConta } from "./jogadores";
import { registrarTentativa } from "./sessao";

// Cadastro com limite de tentativas: "email_em_uso" revela que o e-mail tem
// conta, então cada e-mail (normalizado) e cada IP têm um número máximo de
// tentativas por janela. Bloqueado: nada é criado.
export type ResultadoCadastro = ResultadoCriarConta | { ok: false; erro: "limite" };

export async function criarContaComLimite(
  db: Db,
  d: { nome: string; email: string; senha: string; aceitouTermos: boolean },
  ip: string,
): Promise<ResultadoCadastro> {
  const email = String(d.email ?? "").trim().toLowerCase();
  if (await registrarTentativa(db, `cadastro:${email}`, ip)) return { ok: false, erro: "limite" };
  return criarContaJogador(db, d);
}

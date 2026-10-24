import type { Db } from "./db";
import { apagarContaJogador, criarContaJogador, trocarSenhaJogador, type ResultadoCriarConta } from "./jogadores";
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
  if (await registrarTentativa(db, `cadastro:${email.slice(0, 254)}`, ip)) return { ok: false, erro: "limite" };
  return criarContaJogador(db, d);
}

// Troca de senha e apagar conta conferem a senha atual: quem roubar o cookie
// não pode forçá-la. Limite por jogador e por IP antes de conferir; bloqueado,
// nada é conferido nem mudado. Só a senha errada (`erroSenha`) conta: qualquer
// outro resultado (sucesso, reserva futura, senha nova curta) teve a senha
// certa e zera as tentativas do jogador, senão a recusa repetida viraria
// "muitas tentativas" e esconderia o motivo real.
export type ResultadoComLimite<E extends string> = { ok: true } | { ok: false; erro: E | "limite" };

async function comLimiteDeSenha<E extends string>(
  db: Db, jogadorId: string, ip: string, erroSenha: E, operacao: () => Promise<{ ok: true } | { ok: false; erro: E }>,
): Promise<ResultadoComLimite<E>> {
  const chave = `senha-jogador:${jogadorId}`;
  if (await registrarTentativa(db, chave, ip)) return { ok: false, erro: "limite" };
  const r = await operacao();
  if (r.ok || r.erro !== erroSenha) await db.query("delete from tentativas_login where email = $1", [chave]);
  return r;
}

export function trocarSenhaComLimite(
  db: Db, jogadorId: string, atual: string, nova: string, tokenAtual: string, ip: string,
) {
  return comLimiteDeSenha(db, jogadorId, ip, "senha_atual", () => trocarSenhaJogador(db, jogadorId, atual, nova, tokenAtual));
}

export function apagarContaComLimite(db: Db, jogadorId: string, senha: string, ip: string) {
  return comLimiteDeSenha(db, jogadorId, ip, "senha", () => apagarContaJogador(db, jogadorId, senha));
}

import type { Db } from "./db";
import type { EnviarEmail } from "./email";
import type { TipoConta } from "./entrar-unico";
import { SENHA_JOGADOR_MIN } from "./jogadores";
import { hashSenha, SENHA_MIN_ADMIN, SENHA_MIN_DONO } from "./senha";
import { registrarTentativa } from "./sessao";
import { hashToken, novoToken } from "./segredos";

// "Esqueci a senha" de jogador, dono e admin. O pedido nunca revela se o e-mail
// tem conta (a tela responde sempre a mesma frase); o link é de uso único, vale
// por 1 hora e o banco guarda só o hash do token.

export const VALIDADE_LINK_S = 3600;

const EMAIL_MAX = 254;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url (novoToken)

// Tabelas fixas por tipo (nunca vêm de entrada do usuário).
const CONTA: Record<TipoConta, { tabela: string; sessoes: string; coluna: string; minimo: number }> = {
  jogador: { tabela: "jogadores", sessoes: "sessoes_jogador", coluna: "jogador_id", minimo: SENHA_JOGADOR_MIN },
  dono: { tabela: "usuarios", sessoes: "sessoes", coluna: "usuario_id", minimo: SENHA_MIN_DONO },
  admin: { tabela: "super_admins", sessoes: "sessoes_admin", coluna: "admin_id", minimo: SENHA_MIN_ADMIN },
};

export type ResultadoRedefinir = { ok: true; tipo: TipoConta } | { ok: false; erro: "link" | "senha" };

function textoDoEmail(link: string): string {
  return [
    "Olá,",
    "",
    "Recebemos um pedido para redefinir a senha da sua conta no Replay. Para escolher uma nova senha, abra o link abaixo:",
    "",
    link,
    "",
    "O link vale por 1 hora e só pode ser usado uma vez. Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.",
  ].join("\n");
}

// O pedido tem duas metades. limitarPedido registra a tentativa e devolve o
// e-mail normalizado (ou null se o limite bloqueou); enviarLink acha a conta,
// grava o token e envia. A tela responde logo depois da primeira metade e roda
// a segunda depois da resposta (after): o tempo da resposta não pode revelar
// quem tem conta. Bloqueado ou e-mail sem conta: nada é enviado.
export async function limitarPedido(db: Db, email: string, ip: string): Promise<string | null> {
  const emailNorm = String(email ?? "").trim().toLowerCase().slice(0, EMAIL_MAX);
  if (await registrarTentativa(db, `recuperar:${emailNorm}`, ip)) return null;
  return emailNorm;
}

export async function enviarLink(db: Db, emailNorm: string, appUrl: string, enviar: EnviarEmail): Promise<void> {
  const t = await db.query<{ tipo: TipoConta }>("select tipo from contas_email where email = $1", [emailNorm]);
  const tipo = t.rows[0]?.tipo;
  if (!tipo) return;
  const c = await db.query<{ id: string }>(`select id from ${CONTA[tipo].tabela} where email = $1`, [emailNorm]);
  const contaId = c.rows[0]?.id;
  if (!contaId) return;

  // Limpeza oportunista dos links vencidos há mais de 1 dia.
  await db.query("delete from tokens_senha where expira_em < now() - interval '1 day'");
  const token = novoToken();
  await db.query(
    `insert into tokens_senha (tipo, conta_id, token_hash, expira_em)
     values ($1, $2, $3, now() + make_interval(secs => $4))`,
    [tipo, contaId, hashToken(token), VALIDADE_LINK_S],
  );
  const link = `${appUrl.replace(/\/+$/, "")}/redefinir-senha?t=${token}`;
  await enviar({ para: emailNorm, assunto: "Redefinir sua senha do Replay", texto: textoDoEmail(link) });
}

// As duas metades em sequência (usado nos testes e por quem não precisa do after).
export async function pedirRecuperacao(
  db: Db, email: string, ip: string, appUrl: string, enviar: EnviarEmail,
): Promise<void> {
  const emailNorm = await limitarPedido(db, email, ip);
  if (emailNorm !== null) await enviarLink(db, emailNorm, appUrl, enviar);
}

export async function redefinirSenha(db: Db, token: string, novaSenha: string): Promise<ResultadoRedefinir> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return { ok: false, erro: "link" };
  const r = await db.query<{ id: string; tipo: TipoConta }>(
    "select id, tipo from tokens_senha where token_hash = $1 and usado_em is null and expira_em > now()",
    [hashToken(token)],
  );
  const l = r.rows[0];
  if (!l) return { ok: false, erro: "link" };
  const conta = CONTA[l.tipo];
  // Senha curta não gasta o link: confere antes de marcar o uso.
  if (typeof novaSenha !== "string" || novaSenha.length < conta.minimo) return { ok: false, erro: "senha" };
  const hash = await hashSenha(novaSenha);

  // Um comando só (CTEs): marca o uso, troca o hash, apaga as sessões e os outros
  // links da conta, tudo ou nada. A condição do "t" se repete para que dois usos
  // simultâneos do mesmo link não troquem a senha duas vezes. Conta apagada não
  // casa no "c": nada muda e o link é recusado.
  let feito: { rows: { n: number }[] };
  try {
    feito = await db.query<{ n: number }>(
      `with t as (
         update tokens_senha set usado_em = now()
          where id = $1 and usado_em is null and expira_em > now()
          returning conta_id
       ), c as (
         update ${conta.tabela} set senha_hash = $2
          where id in (select conta_id from t)
          returning id
       ), s as (
         delete from ${conta.sessoes} where ${conta.coluna} in (select id from c)
       ), o as (
         delete from tokens_senha where tipo = $3 and conta_id in (select id from c) and id <> $1
       )
       select count(*)::int as n from c`,
      [l.id, hash, l.tipo],
    );
  } catch (e) {
    // Dois links da mesma conta usados ao mesmo tempo podem travar um no outro
    // (deadlock ou serialização): o perdedor recebe "link" e pede de novo.
    const codigo = (e as { code?: string }).code;
    if (codigo === "40P01" || codigo === "40001") return { ok: false, erro: "link" };
    throw e;
  }
  if (feito.rows[0].n !== 1) return { ok: false, erro: "link" };
  return { ok: true, tipo: l.tipo };
}

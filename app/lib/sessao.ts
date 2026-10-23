import type { Db } from "./db";
import { hashSenha } from "./senha";
import { hashToken, novoToken } from "./segredos";

export const DURACAO_SESSAO_S = 7 * 24 * 3600;

const JANELA_MIN = 15;
const LIMITE_EMAIL = 5;
const LIMITE_IP = 20;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url (novoToken)

export type Sessao = { usuarioId: string; arenaId: string; arenaNome: string; email: string };

// Hash de uma senha sem dono, para e-mail inexistente gastar o mesmo tempo de
// scrypt que um e-mail real (evita revelar quais e-mails existem pelo tempo).
let hashFalso: Promise<string> | undefined;
export function obterHashFalso(): Promise<string> {
  hashFalso ??= hashSenha("senha-que-ninguem-tem");
  return hashFalso;
}

// Registra a tentativa de login e diz se o limite já estourou (true = bloqueado).
// Usada pelo login único (entrar-unico.ts), com a chave `entrar:<email>`.
// O limite por IP soma só as chaves do mesmo prefixo (o trecho antes do
// primeiro ":"); hoje todo login usa `entrar`, então conta todas as contas.
export async function registrarTentativa(db: Db, chave: string, ip: string): Promise<boolean> {
  // Registro pessimista: grava a tentativa ANTES de contar e de conferir a senha.
  // Assim requisições concorrentes enxergam umas às outras e o limite vale de verdade.
  const ins = await db.query<{ id: string }>(
    "insert into tentativas_login (email, ip) values ($1, $2) returning id",
    [chave, ip],
  );
  const idTentativa = ins.rows[0].id;
  const tipo = chave.split(":")[0];

  // A contagem inclui a própria tentativa, por isso o bloqueio é com ">".
  const falhas = await db.query<{ por_email: number; por_ip: number }>(
    `select count(*) filter (where email = $1)::int as por_email,
            count(*) filter (where ip = $2 and split_part(email, ':', 1) = $4)::int as por_ip
       from tentativas_login
      where em > now() - make_interval(mins => $3) and (email = $1 or ip = $2)`,
    [chave, ip, JANELA_MIN, tipo],
  );
  const { por_email, por_ip } = falhas.rows[0];
  if (por_email > LIMITE_EMAIL || por_ip > LIMITE_IP) {
    // Tentativa bloqueada não prolonga o bloqueio.
    await db.query("delete from tentativas_login where id = $1", [idTentativa]);
    return true;
  }
  return false;
}

// Abre a sessão do dono (o login único já conferiu a senha e a arena ativa).
export async function criarSessaoDono(
  db: Db, usuarioId: string, arenaId: string,
): Promise<{ token: string; expiraEm: Date }> {
  // Limpeza oportunista das sessões vencidas.
  await db.query("delete from sessoes where expira_em < now()");
  const token = novoToken();
  const r = await db.query<{ expira_em: Date }>(
    `insert into sessoes (arena_id, usuario_id, token_hash, expira_em)
     values ($1, $2, $3, now() + make_interval(secs => $4)) returning expira_em`,
    [arenaId, usuarioId, hashToken(token), DURACAO_SESSAO_S],
  );
  return { token, expiraEm: new Date(r.rows[0].expira_em) };
}

export async function validarSessao(db: Db, token: string): Promise<Sessao | null> {
  if (!FORMATO_TOKEN.test(token)) return null;
  const r = await db.query<{ usuario_id: string; arena_id: string; arena_nome: string; email: string }>(
    `select s.usuario_id, s.arena_id, a.nome as arena_nome, u.email
       from sessoes s
       join usuarios u on u.id = s.usuario_id and u.arena_id = s.arena_id
       join arenas a on a.id = s.arena_id
      where s.token_hash = $1 and s.expira_em > now()
        and a.status_assinatura = 'ativa'`,
    [hashToken(token)],
  );
  const l = r.rows[0];
  return l ? { usuarioId: l.usuario_id, arenaId: l.arena_id, arenaNome: l.arena_nome, email: l.email } : null;
}

export async function sair(db: Db, token: string): Promise<void> {
  if (!FORMATO_TOKEN.test(token)) return;
  await db.query("delete from sessoes where token_hash = $1", [hashToken(token)]);
}

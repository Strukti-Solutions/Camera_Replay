import type { Db } from "./db";
import { conferirSenha, hashSenha } from "./senha";
import { hashToken, novoToken } from "./segredos";

export const DURACAO_SESSAO_S = 7 * 24 * 3600;

const JANELA_MIN = 15;
const LIMITE_EMAIL = 5;
const LIMITE_IP = 20;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url (novoToken)

export type Sessao = { usuarioId: string; arenaId: string; arenaNome: string; email: string };

export type ResultadoEntrar =
  | { ok: true; token: string; expiraEm: Date }
  | { ok: false; motivo: "credenciais" | "bloqueado" };

// Hash de uma senha sem dono, para e-mail inexistente gastar o mesmo tempo de
// scrypt que um e-mail real (evita revelar quais e-mails existem pelo tempo).
let hashFalso: Promise<string> | undefined;
function obterHashFalso(): Promise<string> {
  hashFalso ??= hashSenha("senha-que-ninguem-tem");
  return hashFalso;
}

export async function entrar(db: Db, email: string, senha: string, ip: string): Promise<ResultadoEntrar> {
  const emailNorm = email.trim().toLowerCase();

  // Limpeza oportunista: sessões vencidas e tentativas com mais de 1 dia.
  await db.query("delete from sessoes where expira_em < now()");
  await db.query("delete from tentativas_login where em < now() - interval '1 day'");

  // O bloqueio vem antes de conferir a senha.
  const falhas = await db.query<{ por_email: number; por_ip: number }>(
    `select count(*) filter (where email = $1)::int as por_email,
            count(*) filter (where ip = $2)::int as por_ip
       from tentativas_login
      where em > now() - make_interval(mins => $3)`,
    [emailNorm, ip, JANELA_MIN],
  );
  const { por_email, por_ip } = falhas.rows[0];
  if (por_email >= LIMITE_EMAIL || por_ip >= LIMITE_IP) return { ok: false, motivo: "bloqueado" };

  const u = await db.query<{ id: string; arena_id: string; senha_hash: string }>(
    "select id, arena_id, senha_hash from usuarios where email = $1",
    [emailNorm],
  );
  const usuario = u.rows[0];
  const certa = await conferirSenha(senha, usuario ? usuario.senha_hash : await obterHashFalso());
  if (!usuario || !certa) {
    await db.query("insert into tentativas_login (email, ip) values ($1, $2)", [emailNorm, ip]);
    return { ok: false, motivo: "credenciais" };
  }

  await db.query("delete from tentativas_login where email = $1", [emailNorm]);
  const token = novoToken();
  const r = await db.query<{ expira_em: Date }>(
    `insert into sessoes (arena_id, usuario_id, token_hash, expira_em)
     values ($1, $2, $3, now() + make_interval(secs => $4)) returning expira_em`,
    [usuario.arena_id, usuario.id, hashToken(token), DURACAO_SESSAO_S],
  );
  return { ok: true, token, expiraEm: new Date(r.rows[0].expira_em) };
}

export async function validarSessao(db: Db, token: string): Promise<Sessao | null> {
  if (!FORMATO_TOKEN.test(token)) return null;
  const r = await db.query<{ usuario_id: string; arena_id: string; arena_nome: string; email: string }>(
    `select s.usuario_id, s.arena_id, a.nome as arena_nome, u.email
       from sessoes s
       join usuarios u on u.id = s.usuario_id and u.arena_id = s.arena_id
       join arenas a on a.id = s.arena_id
      where s.token_hash = $1 and s.expira_em > now()`,
    [hashToken(token)],
  );
  const l = r.rows[0];
  return l ? { usuarioId: l.usuario_id, arenaId: l.arena_id, arenaNome: l.arena_nome, email: l.email } : null;
}

export async function sair(db: Db, token: string): Promise<void> {
  if (!FORMATO_TOKEN.test(token)) return;
  await db.query("delete from sessoes where token_hash = $1", [hashToken(token)]);
}

import type { Db } from "./db";
import { hashToken, novoToken } from "./segredos";

// Sessão do super admin: tabela própria (sessoes_admin), nunca vale como sessão de
// dono nem o contrário. A senha é conferida no login único (entrar-unico.ts);
// o banco guarda só o hash do token.

export const DURACAO_SESSAO_ADMIN_S = 12 * 3600;

const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url (novoToken)

export type SessaoAdmin = { adminId: string; email: string };

// Cookie próprio do super admin: nunca o de dono (replay_sessao). Path /admin: o
// navegador só o manda para as páginas e actions de lá. Fica aqui (e não em
// app/admin) porque o login único em /entrar também o grava.
export const COOKIE_ADMIN = "replay_admin";
export const CAMINHO_COOKIE_ADMIN = "/admin";

// Abre a sessão do admin (o login único já conferiu a senha).
export async function criarSessaoAdmin(db: Db, adminId: string): Promise<{ token: string; expiraEm: Date }> {
  // Limpeza oportunista das sessões vencidas.
  await db.query("delete from sessoes_admin where expira_em < now()");
  const token = novoToken();
  const r = await db.query<{ expira_em: Date }>(
    `insert into sessoes_admin (admin_id, token_hash, expira_em)
     values ($1, $2, now() + make_interval(secs => $3)) returning expira_em`,
    [adminId, hashToken(token), DURACAO_SESSAO_ADMIN_S],
  );
  return { token, expiraEm: new Date(r.rows[0].expira_em) };
}

export async function validarSessaoAdmin(db: Db, token: string): Promise<SessaoAdmin | null> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return null;
  const r = await db.query<{ admin_id: string; email: string }>(
    `select s.admin_id, a.email
       from sessoes_admin s
       join super_admins a on a.id = s.admin_id
      where s.token_hash = $1 and s.expira_em > now()`,
    [hashToken(token)],
  );
  const l = r.rows[0];
  return l ? { adminId: l.admin_id, email: l.email } : null;
}

export async function sairAdmin(db: Db, token: string): Promise<void> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return;
  await db.query("delete from sessoes_admin where token_hash = $1", [hashToken(token)]);
}

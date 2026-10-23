import type { Db } from "./db";
import { conferirSenha } from "./senha";
import { hashToken, novoToken } from "./segredos";
import { obterHashFalso, registrarTentativa } from "./sessao";

// Sessão do super admin: tabela própria (sessoes_admin), nunca vale como sessão de
// dono nem o contrário. Mesmo desenho do login do dono: tentativa
// registrada antes de conferir a senha, chave `admin:<email>`, hash falso para
// e-mail inexistente e só o hash do token no banco.

export const DURACAO_SESSAO_ADMIN_S = 12 * 3600;

const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url (novoToken)

export type SessaoAdmin = { adminId: string; email: string };

export type ResultadoEntrarAdmin =
  | { ok: true; token: string; expiraEm: Date }
  | { ok: false; motivo: "credenciais" | "bloqueado" };

export async function entrarAdmin(db: Db, email: string, senha: string, ip: string): Promise<ResultadoEntrarAdmin> {
  const emailNorm = String(email ?? "").trim().toLowerCase();

  // Limpeza oportunista: sessões vencidas e tentativas com mais de 1 dia.
  await db.query("delete from sessoes_admin where expira_em < now()");
  await db.query("delete from tentativas_login where em < now() - interval '1 day'");

  const chave = `admin:${emailNorm}`;
  if (await registrarTentativa(db, chave, ip)) return { ok: false, motivo: "bloqueado" };

  const a = await db.query<{ id: string; senha_hash: string }>(
    "select id, senha_hash from super_admins where email = $1",
    [emailNorm],
  );
  const admin = a.rows[0];
  const certa = await conferirSenha(String(senha ?? ""), admin ? admin.senha_hash : await obterHashFalso());
  if (!admin || !certa) return { ok: false, motivo: "credenciais" };

  await db.query("delete from tentativas_login where email = $1", [chave]);
  const token = novoToken();
  const r = await db.query<{ expira_em: Date }>(
    `insert into sessoes_admin (admin_id, token_hash, expira_em)
     values ($1, $2, now() + make_interval(secs => $3)) returning expira_em`,
    [admin.id, hashToken(token), DURACAO_SESSAO_ADMIN_S],
  );
  return { ok: true, token, expiraEm: new Date(r.rows[0].expira_em) };
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

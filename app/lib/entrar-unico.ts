import type { Db } from "./db";
import { criarSessaoJogador } from "./jogadores";
import { conferirSenha } from "./senha";
import { criarSessaoDono, obterHashFalso, registrarTentativa } from "./sessao";
import { criarSessaoAdmin } from "./sessao-admin";

// Login único: um formulário para jogador, dono e super admin. O e-mail é único na
// plataforma (contas_email), então ele sozinho diz o tipo da conta. Cada tipo
// continua com a própria tabela de sessão e o próprio cookie.

export type TipoConta = "jogador" | "dono" | "admin";

export type ResultadoEntrarUnico =
  | { ok: true; tipo: TipoConta; token: string; expiraEm: Date }
  | { ok: false; motivo: "credenciais" | "suspensa" };

const CAMINHO_MAX = 512;
const EMAIL_MAX = 254;

type Conta = { id: string; senhaHash: string; arenaId?: string; arenaAtiva?: boolean };

async function buscarConta(db: Db, tipo: TipoConta, email: string): Promise<Conta | null> {
  if (tipo === "jogador") {
    const r = await db.query<{ id: string; senha_hash: string }>(
      "select id, senha_hash from jogadores where email = $1", [email]);
    const l = r.rows[0];
    return l ? { id: l.id, senhaHash: l.senha_hash } : null;
  }
  if (tipo === "admin") {
    const r = await db.query<{ id: string; senha_hash: string }>(
      "select id, senha_hash from super_admins where email = $1", [email]);
    const l = r.rows[0];
    return l ? { id: l.id, senhaHash: l.senha_hash } : null;
  }
  const r = await db.query<{ id: string; arena_id: string; senha_hash: string; status: string }>(
    `select u.id, u.arena_id, u.senha_hash, a.status_assinatura as status
       from usuarios u join arenas a on a.id = u.arena_id
      where u.email = $1`,
    [email],
  );
  const l = r.rows[0];
  return l ? { id: l.id, senhaHash: l.senha_hash, arenaId: l.arena_id, arenaAtiva: l.status === "ativa" } : null;
}

export async function entrarUnico(db: Db, email: string, senha: string, ip: string): Promise<ResultadoEntrarUnico> {
  // Cortado como no cadastro e no "Esqueci a senha": a chave da tentativa fica curta.
  const emailNorm = String(email ?? "").trim().toLowerCase().slice(0, EMAIL_MAX);
  const senhaTexto = typeof senha === "string" ? senha : "";

  // Limpeza oportunista: tentativas com mais de 1 dia.
  await db.query("delete from tentativas_login where em < now() - interval '1 day'");

  // O tipo vem antes da tentativa porque a chave é `<tipo>:<email>`: o limite
  // por IP conta cada tipo à parte, e falhas de jogadores no Wi-Fi da arena não
  // travam o dono nem o admin. E-mail sem conta cai no balde de jogador, para se
  // comportar igual a um jogador (mesma resposta, mesmo scrypt).
  const t = await db.query<{ tipo: TipoConta }>("select tipo from contas_email where email = $1", [emailNorm]);
  const tipo = t.rows[0]?.tipo;
  // Tentativa registrada antes de conferir a senha (registrarTentativa).
  const chave = `${tipo ?? "jogador"}:${emailNorm}`;
  if (await registrarTentativa(db, chave, ip)) {
    // Qualquer bloqueio (e-mail ou IP) responde "credenciais", com o mesmo scrypt
    // (mesmo tempo). O balde do IP é por tipo e a tentativa bloqueada pelo IP não
    // soma no balde do e-mail: um "bloqueado" visível deixaria um atacante que
    // esgota o balde de jogador descobrir quais e-mails são de dono ou admin.
    await conferirSenha(senhaTexto, await obterHashFalso());
    return { ok: false, motivo: "credenciais" };
  }

  const conta = tipo ? await buscarConta(db, tipo, emailNorm) : null;
  // E-mail inexistente gasta o mesmo scrypt que um real: o tempo não revela quem tem conta.
  const certa = await conferirSenha(senhaTexto, conta ? conta.senhaHash : await obterHashFalso());
  if (!tipo || !conta || !certa) return { ok: false, motivo: "credenciais" };
  // Só quem acertou a senha fica sabendo que a arena está suspensa.
  if (tipo === "dono" && !conta.arenaAtiva) return { ok: false, motivo: "suspensa" };

  // Apaga as falhas do e-mail (inclui a linha desta tentativa).
  await db.query("delete from tentativas_login where email = $1", [chave]);
  const s =
    tipo === "jogador" ? await criarSessaoJogador(db, conta.id)
    : tipo === "admin" ? await criarSessaoAdmin(db, conta.id)
    : await criarSessaoDono(db, conta.id, conta.arenaId as string);
  return { ok: true, tipo, token: s.token, expiraEm: s.expiraEm };
}

export function destinoDoTipo(tipo: TipoConta): string {
  if (tipo === "admin") return "/admin";
  if (tipo === "dono") return "/painel";
  return "/minhas-reservas";
}

// Caminho para onde voltar depois do login: só caminho interno do próprio site.
// Recusa "//host" e "/\host" (o navegador lê como outro domínio), esquemas,
// caminhos relativos, barra invertida, caracteres de controle e textos longos.
export function caminhoSeguro(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > CAMINHO_MAX) return null;
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  if (v.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  return v;
}

// Tela de entrar que volta para `voltar` depois do login (e oferece criar conta
// com o mesmo `voltar`). Caminho que não passa em caminhoSeguro é descartado.
export function destinoEntrar(voltar: unknown): string {
  const v = caminhoSeguro(voltar);
  return v ? `/entrar?voltar=${encodeURIComponent(v)}` : "/entrar";
}

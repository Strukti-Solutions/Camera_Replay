import { emTransacao, type Db } from "./db";
import { conferirSenha, hashSenha } from "./senha";
import { hashToken, novoToken } from "./segredos";

// Conta do jogador: vale na plataforma inteira, não pertence a uma arena.
// O e-mail é único entre jogadores, donos e admins (tabela contas_email).

export const TERMOS_VERSAO = "provisorio-2026-10-22";
export const DURACAO_SESSAO_JOGADOR_S = 30 * 24 * 3600;
export const SENHA_JOGADOR_MIN = 8;

const NOME_MAX = 80;
const EMAIL_MAX = 200;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url (novoToken)

export type SessaoJogador = { jogadorId: string; nome: string; email: string };

export type ResultadoCriarConta =
  | { ok: true; jogadorId: string }
  | { ok: false; erro: "nome" | "email" | "senha" | "termos" | "email_em_uso" };

export async function criarContaJogador(
  db: Db,
  d: { nome: string; email: string; senha: string; aceitouTermos: boolean },
): Promise<ResultadoCriarConta> {
  const nome = String(d.nome ?? "").trim();
  const email = String(d.email ?? "").trim().toLowerCase();
  const senha = typeof d.senha === "string" ? d.senha : "";
  if (nome.length < 1 || nome.length > NOME_MAX) return { ok: false, erro: "nome" };
  if (!email.includes("@") || email.length > EMAIL_MAX) return { ok: false, erro: "email" };
  if (senha.length < SENHA_JOGADOR_MIN) return { ok: false, erro: "senha" };
  if (d.aceitouTermos !== true) return { ok: false, erro: "termos" };

  const hash = await hashSenha(senha);
  try {
    const r = await db.query<{ id: string }>(
      `insert into jogadores (nome, email, senha_hash, termos_versao)
       values ($1, $2, $3, $4) returning id`,
      [nome, email, hash, TERMOS_VERSAO],
    );
    return { ok: true, jogadorId: r.rows[0].id };
  } catch (e) {
    // 23505 vem de contas_email (ou da unique de jogadores): e-mail já em uso.
    if ((e as { code?: string }).code === "23505") return { ok: false, erro: "email_em_uso" };
    throw e;
  }
}

export async function criarSessaoJogador(db: Db, jogadorId: string): Promise<{ token: string; expiraEm: Date }> {
  // Limpeza oportunista das sessões vencidas.
  await db.query("delete from sessoes_jogador where expira_em < now()");
  const token = novoToken();
  const r = await db.query<{ expira_em: Date }>(
    `insert into sessoes_jogador (jogador_id, token_hash, expira_em)
     values ($1, $2, now() + make_interval(secs => $3)) returning expira_em`,
    [jogadorId, hashToken(token), DURACAO_SESSAO_JOGADOR_S],
  );
  return { token, expiraEm: new Date(r.rows[0].expira_em) };
}

export async function validarSessaoJogador(db: Db, token: string): Promise<SessaoJogador | null> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return null;
  const r = await db.query<{ jogador_id: string; nome: string; email: string }>(
    `select s.jogador_id, j.nome, j.email
       from sessoes_jogador s join jogadores j on j.id = s.jogador_id
      where s.token_hash = $1 and s.expira_em > now()`,
    [hashToken(token)],
  );
  const l = r.rows[0];
  return l ? { jogadorId: l.jogador_id, nome: l.nome, email: l.email } : null;
}

export async function sairJogador(db: Db, token: string): Promise<void> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return;
  await db.query("delete from sessoes_jogador where token_hash = $1", [hashToken(token)]);
}

export async function atualizarNomeJogador(db: Db, jogadorId: string, nome: string): Promise<boolean> {
  const limpo = String(nome ?? "").trim();
  if (limpo.length < 1 || limpo.length > NOME_MAX) return false;
  const r = await db.query("update jogadores set nome = $2 where id = $1 returning id", [jogadorId, limpo]);
  return r.rows.length > 0;
}

async function hashDoJogador(db: Db, jogadorId: string): Promise<string | null> {
  const r = await db.query<{ senha_hash: string }>("select senha_hash from jogadores where id = $1", [jogadorId]);
  return r.rows[0]?.senha_hash ?? null;
}

export async function trocarSenhaJogador(
  db: Db, jogadorId: string, atual: string, nova: string, tokenAtual: string,
): Promise<{ ok: true } | { ok: false; erro: "senha_atual" | "senha" }> {
  const hash = await hashDoJogador(db, jogadorId);
  if (!hash || !(await conferirSenha(String(atual ?? ""), hash))) return { ok: false, erro: "senha_atual" };
  if (typeof nova !== "string" || nova.length < SENHA_JOGADOR_MIN) return { ok: false, erro: "senha" };
  // Um comando só (CTEs), tudo ou nada: troca o hash, derruba todas as sessões
  // menos a de quem acabou de trocar a senha e apaga os links pendentes de
  // "Esqueci a senha" (um link pedido antes não pode desfazer a troca).
  await db.query(
    `with j as (
       update jogadores set senha_hash = $2 where id = $1 returning id
     ), s as (
       delete from sessoes_jogador where jogador_id in (select id from j) and token_hash <> $3
     )
     delete from tokens_senha where tipo = 'jogador' and conta_id in (select id from j)`,
    [jogadorId, await hashSenha(nova), FORMATO_TOKEN.test(tokenAtual ?? "") ? hashToken(tokenAtual) : ""],
  );
  return { ok: true };
}

// Apaga a conta: sessões saem por cascata, o trigger libera o e-mail e os links
// de "Esqueci a senha" saem junto (tokens_senha não tem chave estrangeira).
// Com reserva confirmada que ainda não terminou, recusa; as passadas ficam com
// jogador_id null (o dono vê "Conta apagada"). Concorrência: a transação trava
// a linha do jogador (for update) e só depois, em comando separado (snapshot
// novo em read committed), confere as reservas; criarReserva trava a mesma
// linha antes de inserir, então nenhuma reserva futura fica órfã.
export async function apagarContaJogador(
  db: Db, jogadorId: string, senha: string,
): Promise<{ ok: true } | { ok: false; erro: "senha" | "reservas_futuras" }> {
  const hash = await hashDoJogador(db, jogadorId);
  if (!hash || !(await conferirSenha(String(senha ?? ""), hash))) return { ok: false, erro: "senha" };
  return emTransacao(db, async (tx) => {
    const j = await tx.query("select id from jogadores where id = $1 for update", [jogadorId]);
    if (j.rows.length === 0) return { ok: false as const, erro: "senha" as const };
    const f = await tx.query(
      `select 1 from reservas
        where jogador_id = $1 and tipo = 'reserva' and situacao = 'confirmada' and fim > now()
        limit 1`,
      [jogadorId],
    );
    if (f.rows.length > 0) return { ok: false as const, erro: "reservas_futuras" as const };
    await tx.query(
      `with j as (delete from jogadores where id = $1 returning id)
       delete from tokens_senha where tipo = 'jogador' and conta_id in (select id from j)`,
      [jogadorId],
    );
    return { ok: true as const };
  });
}

import { expect, test } from "vitest";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrar } from "../db/migrar";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

const CLIPE = `insert into clipes (arena_id, aperto_id, camera_id, recebido_em, expira_em)
  values ($1, $2, $3, now(), now() + interval '7 days') returning id`;
const APERTO = "insert into apertos (arena_id, botao_id) values ($1, $2) returning id";

test("migrar aplica tudo uma vez e é idempotente", async () => {
  const db = await novoBanco();
  const r = await db.query<{ nome: string }>("select nome from schema_migrations");
  expect(r.rows.map((x) => x.nome)).toContain("0001_schema.sql");
  expect(await migrar(db)).toEqual([]);
});

test("botão não pode apontar para quadra de outra arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const qa = await criarQuadra(db, a.id);
  const ca = await criarCamera(db, a.id, qa.id);
  await expect(criarBotao(db, b.id, qa.id, ca.id)).rejects.toThrow(/foreign key/i);
});

test("botão não pode apontar para câmera de outra quadra", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q1 = await criarQuadra(db, a.id), q2 = await criarQuadra(db, a.id);
  const c2 = await criarCamera(db, a.id, q2.id);
  await expect(criarBotao(db, a.id, q1.id, c2.id)).rejects.toThrow(/foreign key/i);
});

test("clipe não pode apontar para câmera de outra arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const qa = await criarQuadra(db, a.id), qb = await criarQuadra(db, b.id);
  const ca = await criarCamera(db, a.id, qa.id);
  const cb = await criarCamera(db, b.id, qb.id);
  const ba = await criarBotao(db, a.id, qa.id, ca.id);
  const ap = await db.query<{ id: string }>(APERTO, [a.id, ba.id]);
  await expect(db.query(CLIPE, [a.id, ap.rows[0].id, cb.id])).rejects.toThrow(/foreign key/i);
});

test("status de clipe fora da lista é recusado", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q.id);
  const b = await criarBotao(db, a.id, q.id, c.id);
  const ap = await db.query<{ id: string }>(APERTO, [a.id, b.id]);
  const cl = await db.query<{ id: string }>(CLIPE, [a.id, ap.rows[0].id, c.id]);
  await expect(db.query("update clipes set status = 'xyz' where id = $1", [cl.rows[0].id]))
    .rejects.toThrow(/check/i);
});

test("slug curto é recusado", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await expect(db.query(
    "insert into quadras (arena_id, nome, slug) values ($1, 'Q', 'abc')", [a.id],
  )).rejects.toThrow(/check/i);
});

test("migrar registra a 0003_camera_fixa", async () => {
  const db = await novoBanco();
  const r = await db.query<{ nome: string }>("select nome from schema_migrations");
  expect(r.rows.map((x) => x.nome)).toContain("0003_camera_fixa.sql");
});

test("câmera não pode ser movida para outra quadra (mesma arena)", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q1 = await criarQuadra(db, a.id), q2 = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q1.id);
  await expect(db.query("update cameras set quadra_id = $2 where id = $1", [c.id, q2.id]))
    .rejects.toMatchObject({ code: "23514", message: expect.stringMatching(/quadra_id/) });
  const r = await db.query<{ quadra_id: string }>("select quadra_id from cameras where id = $1", [c.id]);
  expect(r.rows[0].quadra_id).toBe(q1.id);
});

test("câmera não pode mudar de arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q.id);
  await expect(db.query("update cameras set arena_id = $2 where id = $1", [c.id, b.id]))
    .rejects.toMatchObject({ code: "23514", message: expect.stringMatching(/arena_id/) });
});

test("câmera continua editável: nome, status, visto_em e credenciais", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q.id);
  await db.query(
    "update cameras set nome = 'Nova', status = 'online', visto_em = now(), credenciais = 'v1:a:b:c' where id = $1",
    [c.id],
  );
  const r = await db.query<{ nome: string; status: string; visto_em: Date | null; credenciais: string }>(
    "select nome, status, visto_em, credenciais from cameras where id = $1", [c.id]);
  expect(r.rows[0]).toMatchObject({ nome: "Nova", status: "online", credenciais: "v1:a:b:c" });
  expect(r.rows[0].visto_em).not.toBeNull();
  // update que repete os mesmos quadra_id e arena_id também passa
  await db.query("update cameras set quadra_id = quadra_id, arena_id = arena_id where id = $1", [c.id]);
});

async function criarUsuario(db: Awaited<ReturnType<typeof novoBanco>>, arenaId: string) {
  const r = await db.query<{ id: string }>(
    `insert into usuarios (arena_id, email, senha_hash, papel)
     values ($1, $2, 'h', 'dono') returning id`,
    [arenaId, `${Math.random()}@x.com`],
  );
  return r.rows[0].id;
}

async function criarUsuarioCom(db: Awaited<ReturnType<typeof novoBanco>>, arenaId: string, email: string) {
  const r = await db.query<{ id: string }>(
    "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, $2, 'h', 'dono') returning id",
    [arenaId, email],
  );
  return r.rows[0].id;
}

const SESSAO = `insert into sessoes (arena_id, usuario_id, token_hash, expira_em)
  values ($1, $2, $3, now() + interval '7 days')`;

test("sessão com usuário de outra arena viola a FK", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const u = await criarUsuario(db, a.id);
  await expect(db.query(SESSAO, [b.id, u, "h1"])).rejects.toThrow(/foreign key/i);
});

test("apagar o usuário apaga as sessões", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const u = await criarUsuario(db, a.id);
  await db.query(SESSAO, [a.id, u, "h1"]);
  await db.query("delete from usuarios where id = $1", [u]);
  const r = await db.query("select 1 from sessoes");
  expect(r.rows).toHaveLength(0);
});

test("token_hash da sessão é único", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const u = await criarUsuario(db, a.id);
  await db.query(SESSAO, [a.id, u, "h1"]);
  await expect(db.query(SESSAO, [a.id, u, "h1"])).rejects.toThrow(/unique|duplicate/i);
});

test("tentativas_login grava em com padrão", async () => {
  const db = await novoBanco();
  await db.query("insert into tentativas_login (email, ip) values ('a@x.com', '1.2.3.4')");
  const r = await db.query<{ em: Date }>("select em from tentativas_login");
  expect(r.rows[0].em).toBeInstanceOf(Date);
});

test("cameras.criado_em e botoes.criado_em vêm preenchidos", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q.id);
  const b = await criarBotao(db, a.id, q.id, c.id);
  const rc = await db.query<{ criado_em: Date }>("select criado_em from cameras where id = $1", [c.id]);
  const rb = await db.query<{ criado_em: Date }>("select criado_em from botoes where id = $1", [b.id]);
  expect(rc.rows[0].criado_em).toBeInstanceOf(Date);
  expect(rb.rows[0].criado_em).toBeInstanceOf(Date);
});

// --- 0006: migração registrada (as tabelas de alunos e reservas saíram na 0010) ---

test("migrar registra a 0006_reservas", async () => {
  const db = await novoBanco();
  const r = await db.query<{ nome: string }>("select nome from schema_migrations");
  expect(r.rows.map((x) => x.nome)).toContain("0006_reservas.sql");
});

test("dias_retencao: padrão 3, aceita 1 a 3 e recusa 0 e 4", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  expect((await db.query("select dias_retencao from arenas where id = $1", [a.id])).rows[0].dias_retencao).toBe(3);
  await db.query("update arenas set dias_retencao = 1 where id = $1", [a.id]);
  await db.query("update arenas set dias_retencao = 3 where id = $1", [a.id]);
  await expect(db.query("update arenas set dias_retencao = 4 where id = $1", [a.id])).rejects.toThrow(/check/i);
  await expect(db.query("update arenas set dias_retencao = 0 where id = $1", [a.id])).rejects.toThrow(/check/i);
});

test("migração 0007 reduz arena de 7 dias e clipe com expira_em de 7 dias, sem aumentar os menores", async () => {
  // Banco parado na 0006, com dados no formato antigo.
  const pasta = mkdtempSync(join(tmpdir(), "mig-"));
  try {
    const todas = join(__dirname, "..", "db", "migrations");
    for (const f of readdirSync(todas).filter((x) => x < "0007")) cpSync(join(todas, f), join(pasta, f));
    const db = await novoBanco(pasta);

    const a = await criarArena(db);
    await db.query("update arenas set dias_retencao = 7 where id = $1", [a.id]);
    const b = await criarArena(db);
    await db.query("update arenas set dias_retencao = 2 where id = $1", [b.id]);
    const q = await criarQuadra(db, a.id);
    const c = await criarCamera(db, a.id, q.id);
    const bt = await criarBotao(db, a.id, q.id, c.id);
    const inserir = async (dias: number) => (await db.query<{ id: string }>(
      `insert into clipes (arena_id, aperto_id, camera_id, recebido_em, expira_em)
       values ($1, $2, $3, now(), now() + make_interval(days => $4)) returning id`,
      [a.id, (await db.query<{ id: string }>(APERTO, [a.id, bt.id])).rows[0].id, c.id, dias])).rows[0].id;
    const sete = await inserir(7), um = await inserir(1);

    expect(await migrar(db)).toEqual(["0007_retencao_3_dias.sql", "0008_arena_slug.sql", "0009_super_admin.sql", "0010_sem_alunos.sql", "0011_contas.sql", "0012_tokens_senha.sql", "0013_usuarios_email_minusculo.sql", "0014_fase2.sql", "0015_geocodificacao_tentada.sql", "0016_reservas.sql", "0017_horarios.sql"]);

    const ar = await db.query("select id, dias_retencao from arenas");
    expect(Object.fromEntries(ar.rows.map((x) => [x.id, x.dias_retencao]))).toEqual({ [a.id]: 3, [b.id]: 2 });
    const cl = await db.query(
      "select id, (expira_em = recebido_em + interval '3 days') as tres, (expira_em = recebido_em + interval '1 day') as um from clipes");
    const por = Object.fromEntries(cl.rows.map((x) => [x.id, x]));
    expect(por[sete].tres).toBe(true);
    expect(por[um].um).toBe(true); // prazo menor que 3 dias fica como estava
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test("migração 0008 dá slug próprio às arenas existentes; slug é único, obrigatório e com 20+ caracteres", async () => {
  // Banco parado na 0007, com duas arenas já cadastradas (sem slug).
  const pasta = mkdtempSync(join(tmpdir(), "mig-"));
  try {
    const todas = join(__dirname, "..", "db", "migrations");
    for (const f of readdirSync(todas).filter((x) => x < "0008")) cpSync(join(todas, f), join(pasta, f));
    const db = await novoBanco(pasta);
    await db.query("insert into arenas (nome) values ('A'), ('B')");

    expect(await migrar(db)).toEqual(["0008_arena_slug.sql", "0009_super_admin.sql", "0010_sem_alunos.sql", "0011_contas.sql", "0012_tokens_senha.sql", "0013_usuarios_email_minusculo.sql", "0014_fase2.sql", "0015_geocodificacao_tentada.sql", "0016_reservas.sql", "0017_horarios.sql"]);

    const r = await db.query<{ slug: string }>("select slug from arenas order by nome");
    expect(r.rows).toHaveLength(2);
    for (const { slug } of r.rows) expect(slug).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect(r.rows[0].slug).not.toBe(r.rows[1].slug);

    await expect(db.query("insert into arenas (nome, slug) values ('C', $1)", [r.rows[0].slug])).rejects.toThrow(/unique|duplicate/i);
    await expect(db.query("insert into arenas (nome, slug) values ('C', 'curto')")).rejects.toThrow(/check/i);
    await expect(db.query("insert into arenas (nome, slug) values ('C', $1)", ['a'.repeat(19) + '!'])).rejects.toThrow(/check/i);
    await expect(db.query("insert into arenas (nome, slug) values ('C', $1)", ['a'.repeat(65)])).rejects.toThrow(/check/i);
    await expect(db.query("insert into arenas (nome, slug) values ('C', null)")).rejects.toThrow(/null/i);
    // insert sem slug (fixtures antigas, scripts) ganha um valor válido
    const sem = await db.query<{ slug: string }>("insert into arenas (nome) values ('D') returning slug");
    expect(sem.rows[0].slug).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test("migração 0009 normaliza status_assinatura antigo para ativa e preserva a suspensa", async () => {
  // Banco parado na 0008, com arenas de status antigos.
  const pasta = mkdtempSync(join(tmpdir(), "mig-"));
  try {
    const todas = join(__dirname, "..", "db", "migrations");
    for (const f of readdirSync(todas).filter((x) => x < "0009")) cpSync(join(todas, f), join(pasta, f));
    const db = await novoBanco(pasta);
    await db.query(
      `insert into arenas (nome, slug, status_assinatura)
       values ('A', 'a'||repeat('x', 21), 'ativa'), ('B', 'b'||repeat('x', 21), 'trial'), ('C', 'c'||repeat('x', 21), 'suspensa')`);

    expect(await migrar(db)).toEqual(["0009_super_admin.sql", "0010_sem_alunos.sql", "0011_contas.sql", "0012_tokens_senha.sql", "0013_usuarios_email_minusculo.sql", "0014_fase2.sql", "0015_geocodificacao_tentada.sql", "0016_reservas.sql", "0017_horarios.sql"]);

    const r = await db.query("select nome, status_assinatura from arenas order by nome");
    expect(r.rows).toEqual([
      { nome: "A", status_assinatura: "ativa" },
      { nome: "B", status_assinatura: "ativa" },
      { nome: "C", status_assinatura: "suspensa" },
    ]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test("0010 apaga alunos e reservas (a 0016 recria reservas no formato novo)", async () => {
  const db = await novoBanco();
  for (const t of ["alunos", "reserva_alunos", "clipe_alunos", "sessoes_aluno"]) {
    const r = await db.query<{ r: string | null }>("select to_regclass($1)::text as r", [t]);
    expect(r.rows[0].r, t).toBeNull();
  }
});

test("0011 cria contas_email, jogadores e sessoes_jogador", async () => {
  const db = await novoBanco();
  for (const t of ["contas_email", "jogadores", "sessoes_jogador"]) {
    const r = await db.query<{ r: string | null }>("select to_regclass($1)::text as r", [t]);
    expect(r.rows[0].r, t).not.toBeNull();
  }
});

test("migrações 0010 a 0013 com dados: contas preservadas, alunos fora, só tentativas aluno: apagadas", async () => {
  // Banco parado na 0009, com o formato antigo (alunos e reservas do dono).
  const pasta = mkdtempSync(join(tmpdir(), "mig-"));
  try {
    const todas = join(__dirname, "..", "db", "migrations");
    for (const f of readdirSync(todas).filter((x) => x < "0010")) cpSync(join(todas, f), join(pasta, f));
    const db = await novoBanco(pasta);

    const a = await criarArena(db);
    const dono = await criarUsuarioCom(db, a.id, "dono@x.com");
    const adm = await db.query<{ id: string }>(
      "insert into super_admins (email, senha_hash) values ('adm@x.com', 'h') returning id");
    const q = await criarQuadra(db, a.id);
    const c = await criarCamera(db, a.id, q.id);
    const bt = await criarBotao(db, a.id, q.id, c.id);
    const ap = await db.query<{ id: string }>(APERTO, [a.id, bt.id]);
    const cl = await db.query<{ id: string }>(CLIPE, [a.id, ap.rows[0].id, c.id]);
    const al = await db.query<{ id: string }>(
      "insert into alunos (arena_id, nome, email, senha_hash) values ($1, 'Al', 'al@x.com', 'h') returning id", [a.id]);
    const rs = await db.query<{ id: string }>(
      "insert into reservas (arena_id, quadra_id, inicio, fim) values ($1, $2, now(), now() + interval '1 hour') returning id",
      [a.id, q.id]);
    await db.query("insert into reserva_alunos (reserva_id, aluno_id, arena_id) values ($1, $2, $3)",
      [rs.rows[0].id, al.rows[0].id, a.id]);
    await db.query("insert into tentativas_login (email, ip) values ('aluno:x', '1.1.1.1'), ('dono:y', '1.1.1.1')");

    expect(await migrar(db)).toEqual(["0010_sem_alunos.sql", "0011_contas.sql", "0012_tokens_senha.sql", "0013_usuarios_email_minusculo.sql", "0014_fase2.sql", "0015_geocodificacao_tentada.sql", "0016_reservas.sql", "0017_horarios.sql"]);

    const ids = async (t: string) => (await db.query<{ id: string }>(`select id from ${t}`)).rows.map((x) => x.id);
    expect(await ids("arenas")).toEqual([a.id]);
    expect(await ids("usuarios")).toEqual([dono]);
    expect(await ids("super_admins")).toEqual([adm.rows[0].id]);
    expect(await ids("quadras")).toEqual([q.id]);
    expect(await ids("cameras")).toEqual([c.id]);
    expect(await ids("clipes")).toEqual([cl.rows[0].id]);
    const contas = await db.query("select email, tipo from contas_email order by email");
    expect(contas.rows).toEqual([{ email: "adm@x.com", tipo: "admin" }, { email: "dono@x.com", tipo: "dono" }]);
    for (const t of ["alunos", "reserva_alunos", "clipe_alunos", "sessoes_aluno"]) {
      const r = await db.query<{ r: string | null }>("select to_regclass($1)::text as r", [t]);
      expect(r.rows[0].r, t).toBeNull();
    }
    // A reserva antiga não sobrevive: reservas agora é a tabela nova da 0016, vazia.
    expect(await ids("reservas")).toEqual([]);
    const tent = await db.query("select email from tentativas_login");
    expect(tent.rows).toEqual([{ email: "dono:y" }]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test("0013: e-mail do dono só em minúsculas", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await expect(criarUsuarioCom(db, a.id, "Dono@X.com")).rejects.toThrow(/check/i);
  await criarUsuarioCom(db, a.id, "dono@x.com");
});

test("0014: preço sem quadra da arena, fim ≤ início e taxa 31 são recusados pelo banco", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const qa = await criarQuadra(db, a.id);
  const ins = "insert into precos_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos) values ($1, $2, 1, $3, $4, 8000)";
  await db.query(ins, [a.id, qa.id, 8, 12]);
  await expect(db.query(ins, [b.id, qa.id, 8, 12])).rejects.toThrow(/foreign key/i);
  await expect(db.query(ins, [a.id, qa.id, 12, 12])).rejects.toThrow(/check/i);
  await expect(db.query("update arenas set taxa_percentual = 31 where id = $1", [a.id])).rejects.toThrow(/check/i);
  const t = await db.query<{ taxa_percentual: string }>("select taxa_percentual from arenas where id = $1", [a.id]);
  expect(Number(t.rows[0].taxa_percentual)).toBe(5);
  await db.query("delete from quadras where id = $1", [qa.id]);
  const n = await db.query("select 1 from precos_quadra where arena_id = $1", [a.id]);
  expect(n.rows).toHaveLength(0);
});

// --- 0016: reservas e bloqueios sem sobreposição ---

const JOGADOR = `insert into jogadores (nome, email, senha_hash, termos_versao)
  values ('Jo', $1, 'h', 'v1') returning id`;
const RESERVA = `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim,
    pagamento, total_centavos, taxa_centavos, detalhe)
  values ($1, $2, $3, 'reserva', $4, $5, $6, 'arena', 8000, 0, '[{"hora":18,"precoCentavos":8000}]') returning id`;
const BLOQUEIO = `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim, motivo)
  values ($1, $2, $3, 'bloqueio', 'confirmada', $4, $5, $6) returning id`;

test("0016: duas reservas sobrepostas na mesma quadra são recusadas pelo banco; encostadas e canceladas não", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const q = await criarQuadra(db, a.id), q2 = await criarQuadra(db, a.id), qb = await criarQuadra(db, b.id);
  const j = (await db.query<{ id: string }>(JOGADOR, ["jo@x.com"])).rows[0].id;
  const h = (x: number) => `2026-10-30T${String(x).padStart(2, "0")}:00:00-03:00`;
  await db.query(RESERVA, [a.id, q.id, j, "confirmada", h(18), h(20)]);
  await expect(db.query(RESERVA, [a.id, q.id, j, "confirmada", h(19), h(21)]))
    .rejects.toMatchObject({ code: "23P01" });
  await expect(db.query(RESERVA, [a.id, q.id, j, "segurada", h(17), h(19)]))
    .rejects.toMatchObject({ code: "23P01" });
  await expect(db.query(BLOQUEIO, [a.id, q.id, null, h(19), h(20), "Telefone"]))
    .rejects.toMatchObject({ code: "23P01" });
  // encostadas, outra quadra, canceladas/expiradas: aceitas
  await db.query(RESERVA, [a.id, q.id, j, "confirmada", h(20), h(22)]);
  await db.query(BLOQUEIO, [a.id, q.id, null, h(16), h(18), "Telefone"]);
  await db.query(RESERVA, [a.id, q2.id, j, "confirmada", h(18), h(20)]);
  await db.query(RESERVA, [a.id, q.id, j, "cancelada", h(18), h(20)]);
  await db.query(RESERVA, [a.id, q.id, j, "expirada", h(18), h(20)]);
  // cancelar libera o horário
  const r = await db.query<{ id: string }>("select id from reservas where quadra_id = $1 and inicio = $2 and situacao = 'confirmada'", [q.id, h(18)]);
  await db.query("update reservas set situacao = 'cancelada', cancelada_em = now(), cancelada_por = 'dono' where id = $1", [r.rows[0].id]);
  await db.query(RESERVA, [a.id, q.id, j, "confirmada", h(18), h(20)]);
  // quadra de outra arena, fim ≤ início, mais de 12 h, situação fora da lista
  await expect(db.query(RESERVA, [a.id, qb.id, j, "confirmada", h(8), h(9)])).rejects.toThrow(/foreign key/i);
  await expect(db.query(RESERVA, [a.id, q.id, j, "confirmada", h(9), h(9)])).rejects.toThrow(/check/i);
  await expect(db.query(RESERVA, [a.id, q.id, j, "confirmada", "2026-10-31T00:00:00-03:00", "2026-10-31T13:00:00-03:00"]))
    .rejects.toThrow(/check/i);
  await expect(db.query(RESERVA, [a.id, q.id, j, "paga", h(1), h(2)])).rejects.toThrow(/check/i);
  // período gerado é [inicio, fim)
  const p = await db.query<{ ok: boolean }>("select periodo = tstzrange($1::timestamptz, $2::timestamptz, '[)') as ok from reservas where quadra_id = $3 and inicio = $1 and situacao = 'confirmada'", [h(20), h(22), q.id]);
  expect(p.rows[0].ok).toBe(true);
  // apagar o jogador deixa a reserva com jogador_id null
  await db.query("delete from jogadores where id = $1", [j]);
  const n = await db.query("select 1 from reservas where jogador_id is not null");
  expect(n.rows).toHaveLength(0);
});

test("bloqueio exige motivo e não tem jogador", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const j = (await db.query<{ id: string }>(JOGADOR, ["jo@x.com"])).rows[0].id;
  const i = "2026-10-30T08:00:00-03:00", f = "2026-10-30T09:00:00-03:00";
  await expect(db.query(BLOQUEIO, [a.id, q.id, null, i, f, null])).rejects.toThrow(/check/i);
  await expect(db.query(BLOQUEIO, [a.id, q.id, j, i, f, "Telefone"])).rejects.toThrow(/check/i);
  await expect(db.query(
    "insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim) values ($1, $2, $3, 'reserva', 'confirmada', $4, $5)",
    [a.id, q.id, j, i, f])).rejects.toThrow(/check/i);
  await expect(db.query(
    "insert into reservas (arena_id, quadra_id, tipo, situacao, inicio, fim, motivo) values ($1, $2, 'outro', 'confirmada', $3, $4, 'x')",
    [a.id, q.id, i, f])).rejects.toThrow(/check/i);
  await db.query(BLOQUEIO, [a.id, q.id, null, i, f, "Reserva por telefone — João"]);
});

const HORARIO = "insert into horarios_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos) values ($1, $2, $3, $4, $5, 8000)";

test("0017: horários não se sobrepõem no mesmo dia e quadra, mas podem encostar", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const b = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const qb = await criarQuadra(db, b.id);
  await db.query(HORARIO, [a.id, q.id, 1, 420, 480]);
  await db.query(HORARIO, [a.id, q.id, 1, 480, 540]); // encostado
  await db.query(HORARIO, [a.id, q.id, 2, 420, 480]); // outro dia
  await expect(db.query(HORARIO, [a.id, q.id, 1, 450, 510])).rejects.toThrow(/exclusion/i);
  await expect(db.query(HORARIO, [a.id, qb.id, 1, 420, 480])).rejects.toThrow(/foreign key/i);
  await expect(db.query(HORARIO, [a.id, q.id, 3, 600, 610])).rejects.toThrow(/check/i);
  await db.query("delete from quadras where id = $1", [q.id]);
  const n = await db.query("select 1 from horarios_quadra");
  expect(n.rows).toHaveLength(0);
});

test("migração 0017 copia cada faixa de precos_quadra em horários de 1 hora", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "mig-"));
  try {
    const todas = join(__dirname, "..", "db", "migrations");
    for (const f of readdirSync(todas).filter((x) => x < "0017")) cpSync(join(todas, f), join(pasta, f));
    const db = await novoBanco(pasta);
    const a = await criarArena(db);
    const q = await criarQuadra(db, a.id);
    await db.query(
      "insert into precos_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos) values ($1, $2, 1, 7, 9, 8000)",
      [a.id, q.id]);
    expect(await migrar(db)).toEqual(["0017_horarios.sql"]);
    const r = await db.query("select dia_semana, inicio, fim, preco_centavos from horarios_quadra order by inicio");
    expect(r.rows).toEqual([
      { dia_semana: 1, inicio: 420, fim: 480, preco_centavos: 8000 },
      { dia_semana: 1, inicio: 480, fim: 540, preco_centavos: 8000 },
    ]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});


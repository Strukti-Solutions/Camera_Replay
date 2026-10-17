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

// --- 0006: alunos e reservas ---

async function alunoDe(db: Awaited<ReturnType<typeof novoBanco>>, arenaId: string, email = "a@x.com") {
  const r = await db.query<{ id: string }>(
    "insert into alunos (arena_id, nome, email, senha_hash) values ($1, 'Ana', $2, 'h') returning id",
    [arenaId, email]);
  return r.rows[0].id;
}
const RESERVA = `insert into reservas (arena_id, quadra_id, inicio, fim)
  values ($1, $2, $3::timestamptz, $4::timestamptz) returning id`;

test("migrar registra a 0006_reservas", async () => {
  const db = await novoBanco();
  const r = await db.query<{ nome: string }>("select nome from schema_migrations");
  expect(r.rows.map((x) => x.nome)).toContain("0006_reservas.sql");
});

test("aluno: e-mail único por arena, igual em outra arena é aceito", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  await alunoDe(db, a.id);
  await expect(alunoDe(db, a.id)).rejects.toThrow(/unique|duplicate/i);
  await expect(alunoDe(db, b.id)).resolves.toBeTruthy();
});

test("reserva: fim <= início e mais de 12 h violam o check", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  await expect(db.query(RESERVA, [a.id, q.id, "2026-10-17T10:00Z", "2026-10-17T10:00Z"])).rejects.toThrow(/check/i);
  await expect(db.query(RESERVA, [a.id, q.id, "2026-10-17T00:00Z", "2026-10-17T12:01Z"])).rejects.toThrow(/check/i);
  await expect(db.query(RESERVA, [a.id, q.id, "2026-10-17T00:00Z", "2026-10-17T12:00Z"])).resolves.toBeTruthy();
});

test("reserva não pode apontar para quadra de outra arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const qa = await criarQuadra(db, a.id);
  await expect(db.query(RESERVA, [b.id, qa.id, "2026-10-17T10:00Z", "2026-10-17T11:00Z"]))
    .rejects.toThrow(/foreign key/i);
});

test("reserva_alunos: aluno de outra arena viola a FK e apagar a reserva ou o aluno apaga o vínculo", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const al = await alunoDe(db, a.id), alB = await alunoDe(db, b.id);
  const r = (await db.query<{ id: string }>(RESERVA, [a.id, q.id, "2026-10-17T10:00Z", "2026-10-17T11:00Z"])).rows[0].id;
  const VINCULO = "insert into reserva_alunos (reserva_id, aluno_id, arena_id) values ($1,$2,$3)";
  await expect(db.query(VINCULO, [r, alB, a.id])).rejects.toThrow(/foreign key/i);
  await db.query(VINCULO, [r, al, a.id]);
  await expect(db.query(VINCULO, [r, al, a.id])).rejects.toThrow(/unique|duplicate/i);
  await db.query("delete from alunos where id = $1", [al]);
  expect((await db.query("select 1 from reserva_alunos")).rows).toHaveLength(0);
  await db.query(VINCULO, [r, await alunoDe(db, a.id, "o@x.com"), a.id]);
  await db.query("delete from reservas where id = $1", [r]);
  expect((await db.query("select 1 from reserva_alunos")).rows).toHaveLength(0);
});

test("clipe_alunos: FKs compostas e cascade", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const q = await criarQuadra(db, a.id);
  const c = await criarCamera(db, a.id, q.id);
  const bt = await criarBotao(db, a.id, q.id, c.id);
  const ap = await db.query<{ id: string }>(APERTO, [a.id, bt.id]);
  const cl = (await db.query<{ id: string }>(CLIPE, [a.id, ap.rows[0].id, c.id])).rows[0].id;
  const al = await alunoDe(db, a.id), alB = await alunoDe(db, b.id);
  const ATRIB = "insert into clipe_alunos (clipe_id, aluno_id, arena_id) values ($1,$2,$3)";
  await expect(db.query(ATRIB, [cl, alB, a.id])).rejects.toThrow(/foreign key/i);
  await expect(db.query(ATRIB, [cl, al, b.id])).rejects.toThrow(/foreign key/i);
  await db.query(ATRIB, [cl, al, a.id]);
  await db.query("delete from clipes where id = $1", [cl]);
  expect((await db.query("select 1 from clipe_alunos")).rows).toHaveLength(0);
});

test("sessoes_aluno: aluno de outra arena viola a FK; apagar o aluno apaga a sessão; token único", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const al = await alunoDe(db, a.id);
  const SA = `insert into sessoes_aluno (arena_id, aluno_id, token_hash, expira_em)
    values ($1,$2,$3, now() + interval '7 days')`;
  await expect(db.query(SA, [b.id, al, "h1"])).rejects.toThrow(/foreign key/i);
  await db.query(SA, [a.id, al, "h1"]);
  await expect(db.query(SA, [a.id, al, "h1"])).rejects.toThrow(/unique|duplicate/i);
  await db.query("delete from alunos where id = $1", [al]);
  expect((await db.query("select 1 from sessoes_aluno")).rows).toHaveLength(0);
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

    expect(await migrar(db)).toEqual(["0007_retencao_3_dias.sql", "0008_arena_slug.sql"]);

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

    expect(await migrar(db)).toEqual(["0008_arena_slug.sql"]);

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

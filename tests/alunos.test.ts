import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { ErroPainel } from "../app/lib/painel";
import { criarAluno, listarAlunos, redefinirSenhaAluno, removerAluno } from "../app/lib/alunos";
import { novoBanco } from "./db";
import { criarArena } from "./fixtures";

const dados = { nome: "  Ana Souza ", email: " Ana@Exemplo.com ", senha: "senha-boa-1" };

const fotoAlunos = async (db: Db, arenaId: string) =>
  JSON.stringify((await db.query("select * from alunos where arena_id = $1 order by id", [arenaId])).rows);

test("criarAluno normaliza nome e e-mail e guarda só o hash", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const { id } = await criarAluno(db, a.id, dados);
  const r = await db.query<{ nome: string; email: string; senha_hash: string }>(
    "select nome, email, senha_hash from alunos where id = $1", [id]);
  expect(r.rows[0]).toMatchObject({ nome: "Ana Souza", email: "ana@exemplo.com" });
  expect(r.rows[0].senha_hash).toMatch(/^scrypt\$/);
  expect(r.rows[0].senha_hash).not.toContain("senha-boa-1");
});

test("nome vazio ou longo, e-mail inválido e senha curta são recusados", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  for (const ruim of [
    { ...dados, nome: "   " }, { ...dados, nome: "x".repeat(81) },
    { ...dados, email: "sem-arroba" }, { ...dados, senha: "curta12" },
  ]) {
    await expect(criarAluno(db, a.id, ruim)).rejects.toBeInstanceOf(ErroPainel);
  }
  expect(await listarAlunos(db, a.id)).toEqual([]);
});

test("e-mail repetido (com maiúsculas) é recusado na arena e aceito em outra", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  await criarAluno(db, a.id, dados);
  await expect(criarAluno(db, a.id, { ...dados, email: "ANA@exemplo.COM" }))
    .rejects.toMatchObject({ name: "ErroPainel", message: "e-mail já cadastrado" });
  await expect(criarAluno(db, b.id, dados)).resolves.toHaveProperty("id");
});

test("listarAlunos devolve contagem de reservas e nunca senha_hash", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await criarAluno(db, a.id, dados);
  const l = await listarAlunos(db, a.id);
  expect(l).toHaveLength(1);
  expect(l[0]).toMatchObject({ nome: "Ana Souza", email: "ana@exemplo.com", reservas: 0 });
  expect(l[0].criadoEm).toBeInstanceOf(Date);
  expect(JSON.stringify(l)).not.toMatch(/senha|scrypt/);
});

test("redefinirSenhaAluno troca o hash e apaga as sessões do aluno", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const { id } = await criarAluno(db, a.id, dados);
  const antes = (await db.query<{ senha_hash: string }>("select senha_hash from alunos where id=$1", [id])).rows[0].senha_hash;
  await db.query(
    "insert into sessoes_aluno (arena_id, aluno_id, token_hash, expira_em) values ($1,$2,'h1', now() + interval '7 days')",
    [a.id, id]);
  expect(await redefinirSenhaAluno(db, a.id, id, "outra-senha-9")).toBe(true);
  const depois = (await db.query<{ senha_hash: string }>("select senha_hash from alunos where id=$1", [id])).rows[0].senha_hash;
  expect(depois).not.toBe(antes);
  expect((await db.query("select 1 from sessoes_aluno")).rows).toHaveLength(0);
  await expect(redefinirSenhaAluno(db, a.id, id, "curta")).rejects.toBeInstanceOf(ErroPainel);
});

test("removerAluno apaga o aluno", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const { id } = await criarAluno(db, a.id, dados);
  expect(await removerAluno(db, a.id, id)).toBe(true);
  expect(await removerAluno(db, a.id, id)).toBe(false);
  expect(await listarAlunos(db, a.id)).toEqual([]);
});

test("ids de outra arena ou malformados se comportam como inexistentes e não alteram B", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const { id } = await criarAluno(db, b.id, dados);
  const antes = await fotoAlunos(db, b.id);
  expect(await redefinirSenhaAluno(db, a.id, id, "outra-senha-9")).toBe(false);
  expect(await removerAluno(db, a.id, id)).toBe(false);
  expect(await listarAlunos(db, a.id)).toEqual([]);
  expect(await removerAluno(db, a.id, "nao-e-uuid")).toBe(false);
  expect(await redefinirSenhaAluno(db, "x", id, "outra-senha-9")).toBe(false);
  expect(await listarAlunos(db, "x")).toEqual([]);
  expect(await fotoAlunos(db, b.id)).toBe(antes);
});

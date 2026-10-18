import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { ErroPainel } from "../app/lib/painel";
import { criarAluno, listarAlunos, listarAlunosParaEscolha, redefinirSenhaAluno, removerAluno } from "../app/lib/alunos";
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
  expect((await listarAlunos(db, a.id)).alunos).toEqual([]);
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
  const l = (await listarAlunos(db, a.id)).alunos;
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
  expect((await listarAlunos(db, a.id)).alunos).toEqual([]);
});

test("ids de outra arena ou malformados se comportam como inexistentes e não alteram B", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  const { id } = await criarAluno(db, b.id, dados);
  const antes = await fotoAlunos(db, b.id);
  expect(await redefinirSenhaAluno(db, a.id, id, "outra-senha-9")).toBe(false);
  expect(await removerAluno(db, a.id, id)).toBe(false);
  expect((await listarAlunos(db, a.id)).alunos).toEqual([]);
  expect(await removerAluno(db, a.id, "nao-e-uuid")).toBe(false);
  expect(await redefinirSenhaAluno(db, "x", id, "outra-senha-9")).toBe(false);
  expect((await listarAlunos(db, "x")).alunos).toEqual([]);
  expect(await fotoAlunos(db, b.id)).toBe(antes);
});

// Cria n alunos "Aluno 01".."Aluno nn" direto no banco (sem o custo do scrypt).
async function semear(db: Db, arenaId: string, n: number) {
  for (let i = 1; i <= n; i++) {
    const t = String(i).padStart(2, "0");
    await db.query("insert into alunos (arena_id, nome, email, senha_hash) values ($1,$2,$3,'x')",
      [arenaId, `Aluno ${t}`, `aluno${t}@exemplo.com`]);
  }
}

test("listarAlunos pagina de 10 em 10 e prende a página entre 1 e paginas", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await semear(db, a.id, 23);
  const p1 = await listarAlunos(db, a.id);
  expect(p1).toMatchObject({ total: 23, pagina: 1, paginas: 3 });
  expect(p1.alunos).toHaveLength(10);
  expect(p1.alunos[0].nome).toBe("Aluno 01");
  const p3 = await listarAlunos(db, a.id, { pagina: 3 });
  expect(p3.alunos).toHaveLength(3);
  expect(p3.alunos[2].nome).toBe("Aluno 23");
  const p99 = await listarAlunos(db, a.id, { pagina: 99 });
  expect(p99.pagina).toBe(3);
  expect(p99.alunos).toHaveLength(3);
  expect((await listarAlunos(db, a.id, { pagina: 0 })).pagina).toBe(1);
  expect((await listarAlunos(db, a.id, { pagina: -4 })).pagina).toBe(1);
});

test("porPagina padrão 10, máximo 50", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await semear(db, a.id, 60);
  expect((await listarAlunos(db, a.id, { porPagina: 5 })).alunos).toHaveLength(5);
  const g = await listarAlunos(db, a.id, { porPagina: 500 });
  expect(g.alunos).toHaveLength(50);
  expect(g.paginas).toBe(2);
});

test("sem alunos: paginas = 1 e lista vazia", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  expect(await listarAlunos(db, a.id)).toEqual({ alunos: [], total: 0, pagina: 1, paginas: 1 });
});

test("busca por parte do nome ou do e-mail, sem diferenciar maiúsculas", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await criarAluno(db, a.id, { nome: "Ana Souza", email: "ana@exemplo.com", senha: "senha-boa-1" });
  await criarAluno(db, a.id, { nome: "Bruno Lima", email: "bruno@quadra.com", senha: "senha-boa-1" });
  expect((await listarAlunos(db, a.id, { busca: "SOUZ" })).alunos.map((x) => x.nome)).toEqual(["Ana Souza"]);
  const porEmail = await listarAlunos(db, a.id, { busca: "  @QUADRA " });
  expect(porEmail.total).toBe(1);
  expect(porEmail.alunos[0].nome).toBe("Bruno Lima");
  expect((await listarAlunos(db, a.id, { busca: "   " })).total).toBe(2);
});

test("busca com % e _ vale como texto literal", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  for (const [i, nome] of ["Ana 100%", "Beto_Silva", "Caio Souza"].entries()) {
    await db.query("insert into alunos (arena_id, nome, email, senha_hash) values ($1,$2,$3,'x')",
      [a.id, nome, `u${i}@exemplo.com`]);
  }
  expect((await listarAlunos(db, a.id, { busca: "%" })).alunos.map((x) => x.nome)).toEqual(["Ana 100%"]);
  expect((await listarAlunos(db, a.id, { busca: "_" })).alunos.map((x) => x.nome)).toEqual(["Beto_Silva"]);
});

test("a busca é cortada em 80 caracteres", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await criarAluno(db, a.id, { nome: "a".repeat(80), email: "a@exemplo.com", senha: "senha-boa-1" });
  expect((await listarAlunos(db, a.id, { busca: "a".repeat(80) + "zzz" })).total).toBe(1);
});

test("listarAlunos nunca mostra alunos de outra arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db), b = await criarArena(db);
  await semear(db, b.id, 12);
  expect(await listarAlunos(db, a.id)).toMatchObject({ total: 0, alunos: [] });
  expect(await listarAlunos(db, a.id, { busca: "Aluno" })).toMatchObject({ total: 0 });
  expect(await listarAlunosParaEscolha(db, a.id)).toEqual([]);
});

test("listarAlunosParaEscolha devolve todos por nome, só id e nome", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await semear(db, a.id, 13);
  const l = await listarAlunosParaEscolha(db, a.id);
  expect(l).toHaveLength(13);
  expect(l[0].nome).toBe("Aluno 01");
  expect(Object.keys(l[0]).sort()).toEqual(["id", "nome"]);
  expect(await listarAlunosParaEscolha(db, "x")).toEqual([]);
});

test("busca com caractere NUL não quebra a consulta (o NUL é descartado)", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await criarAluno(db, a.id, { nome: "Ana Souza", email: "ana@exemplo.com", senha: "senha-boa-1" });
  expect((await listarAlunos(db, a.id, { busca: "So\u0000uza" })).alunos.map((x) => x.nome)).toEqual(["Ana Souza"]);
  expect((await listarAlunos(db, a.id, { busca: "\u0000" })).total).toBe(1);
});

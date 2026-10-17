import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { ErroPainel } from "../app/lib/painel";
import { criarAluno, listarAlunos, removerAluno } from "../app/lib/alunos";
import {
  criarReserva, definirAlunosDaReserva, listarReservas, removerReserva,
} from "../app/lib/reservas";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

const h = (hora: number, min = 0) => new Date(Date.UTC(2026, 9, 17, hora, min));

async function cenario(db: Db) {
  const a = await criarArena(db), b = await criarArena(db);
  const qa = await criarQuadra(db, a.id), qb = await criarQuadra(db, b.id);
  const alA = await criarAluno(db, a.id, { nome: "Ana Souza", email: "ana@x.com", senha: "senha-boa-1" });
  const alA2 = await criarAluno(db, a.id, { nome: "Beto Lima", email: "beto@x.com", senha: "senha-boa-1" });
  const alB = await criarAluno(db, b.id, { nome: "Caio", email: "caio@x.com", senha: "senha-boa-1" });
  return { a, b, qa, qb, alA, alA2, alB };
}

async function clipeEm(
  db: Db, arenaId: string, quadraId: string, quando: Date,
  o: { status?: string; expiraEmSeg?: number } = {},
) {
  const cam = await criarCamera(db, arenaId, quadraId);
  const bt = await criarBotao(db, arenaId, quadraId, cam.id);
  const ap = await db.query<{ id: string }>(
    "insert into apertos (arena_id, botao_id) values ($1,$2) returning id", [arenaId, bt.id]);
  await db.query(
    `insert into clipes (arena_id, aperto_id, camera_id, status, recebido_em, expira_em)
     values ($1,$2,$3,$4,$5, now() + make_interval(secs => $6))`,
    [arenaId, ap.rows[0].id, cam.id, o.status ?? "pronto", quando, o.expiraEmSeg ?? 3600]);
}

const fotoArena = async (db: Db, arenaId: string) => {
  const out: unknown[] = [];
  for (const n of ["alunos", "reservas", "reserva_alunos", "clipe_alunos"]) {
    out.push((await db.query(`select * from ${n} where arena_id = $1 order by 1, 2`, [arenaId])).rows);
  }
  return JSON.stringify(out);
};

test("criarReserva grava e listarReservas devolve alunos e quadra, sem senha_hash", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r = await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(8), fim: h(10), alunoIds: [s.alA.id, s.alA2.id] });
  expect(r).toHaveProperty("id");
  const l = await listarReservas(db, s.a.id, {});
  expect(l).toHaveLength(1);
  expect(l[0]).toMatchObject({ id: r!.id, quadraId: s.qa.id, quadraNome: "Quadra 1", lances: 0 });
  expect(l[0].inicio).toEqual(h(8));
  expect(l[0].alunos.map((x) => x.nome).sort()).toEqual(["Ana Souza", "Beto Lima"]);
  expect(JSON.stringify(l)).not.toMatch(/senha|scrypt|email/);
  expect((await listarAlunos(db, s.a.id)).find((x) => x.id === s.alA.id)?.reservas).toBe(1);
});

test("sobreposição é recusada e reservas encostadas são aceitas", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const base = { quadraId: s.qa.id, alunoIds: [s.alA.id] };
  await criarReserva(db, s.a.id, { ...base, inicio: h(8), fim: h(10) });
  await expect(criarReserva(db, s.a.id, { ...base, inicio: h(9), fim: h(11) }))
    .rejects.toMatchObject({ name: "ErroPainel", message: "já existe reserva nesse horário" });
  await expect(criarReserva(db, s.a.id, { ...base, inicio: h(7), fim: h(8, 1) })).rejects.toBeInstanceOf(ErroPainel);
  await expect(criarReserva(db, s.a.id, { ...base, inicio: h(10), fim: h(12) })).resolves.toHaveProperty("id");
  await expect(criarReserva(db, s.a.id, { ...base, inicio: h(6), fim: h(8) })).resolves.toHaveProperty("id");
  // outra quadra, mesmo horário, é livre
  const q2 = await criarQuadra(db, s.a.id);
  await expect(criarReserva(db, s.a.id, { quadraId: q2.id, alunoIds: [s.alA.id], inicio: h(8), fim: h(10) }))
    .resolves.toHaveProperty("id");
});

test("fim <= início, mais de 12 h, data inválida e sem aluno são recusados", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const base = { quadraId: s.qa.id, alunoIds: [s.alA.id] };
  await expect(criarReserva(db, s.a.id, { ...base, inicio: h(10), fim: h(10) })).rejects.toBeInstanceOf(ErroPainel);
  await expect(criarReserva(db, s.a.id, { ...base, inicio: h(10), fim: h(9) })).rejects.toBeInstanceOf(ErroPainel);
  await expect(criarReserva(db, s.a.id, { ...base, inicio: h(0), fim: h(13) })).rejects.toBeInstanceOf(ErroPainel);
  await expect(criarReserva(db, s.a.id, { ...base, inicio: new Date("x"), fim: h(9) })).rejects.toBeInstanceOf(ErroPainel);
  await expect(criarReserva(db, s.a.id, { ...base, alunoIds: [], inicio: h(8), fim: h(9) })).rejects.toBeInstanceOf(ErroPainel);
  await expect(criarReserva(db, s.a.id, { ...base, inicio: h(0), fim: h(12) })).resolves.toHaveProperty("id");
  expect(await listarReservas(db, s.a.id, {})).toHaveLength(1);
});

test("quadra de outra arena devolve null; aluno de outra arena é ignorado", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const antes = await fotoArena(db, s.b.id);
  expect(await criarReserva(db, s.a.id, { quadraId: s.qb.id, alunoIds: [s.alA.id], inicio: h(8), fim: h(9) })).toBeNull();
  expect(await criarReserva(db, s.a.id, { quadraId: "nao-uuid", alunoIds: [s.alA.id], inicio: h(8), fim: h(9) })).toBeNull();
  // aluno de B misturado: só o de A entra
  const r = await criarReserva(db, s.a.id, { quadraId: s.qa.id, alunoIds: [s.alA.id, s.alB.id, "lixo"], inicio: h(8), fim: h(9) });
  const l = await listarReservas(db, s.a.id, {});
  expect(l[0].alunos.map((x) => x.id)).toEqual([s.alA.id]);
  // só aluno de outra arena: nenhum aluno válido, recusa
  await expect(criarReserva(db, s.a.id, { quadraId: s.qa.id, alunoIds: [s.alB.id], inicio: h(10), fim: h(11) }))
    .rejects.toBeInstanceOf(ErroPainel);
  expect(r).not.toBeNull();
  expect(await fotoArena(db, s.b.id)).toBe(antes);
});

test("listarReservas ordena por início desc e filtra por quadra e desde", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const q2 = await criarQuadra(db, s.a.id);
  const base = { alunoIds: [s.alA.id] };
  await criarReserva(db, s.a.id, { ...base, quadraId: s.qa.id, inicio: h(8), fim: h(9) });
  await criarReserva(db, s.a.id, { ...base, quadraId: s.qa.id, inicio: h(10), fim: h(11) });
  await criarReserva(db, s.a.id, { ...base, quadraId: q2.id, inicio: h(12), fim: h(13) });
  const todas = await listarReservas(db, s.a.id, {});
  expect(todas.map((x) => x.inicio)).toEqual([h(12), h(10), h(8)]);
  expect((await listarReservas(db, s.a.id, { quadraId: s.qa.id })).map((x) => x.inicio)).toEqual([h(10), h(8)]);
  expect((await listarReservas(db, s.a.id, { desde: h(10) })).map((x) => x.inicio)).toEqual([h(12), h(10)]);
  expect(await listarReservas(db, s.b.id, {})).toEqual([]);
  expect(await listarReservas(db, s.a.id, { quadraId: "lixo" })).toEqual([]);
});

test("lances: só pronto/parcial, não expirado, na janela semiaberta [início, fim) e na quadra da reserva", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const q2 = await criarQuadra(db, s.a.id);
  await criarReserva(db, s.a.id, { quadraId: s.qa.id, alunoIds: [s.alA.id], inicio: h(8), fim: h(10) });
  await clipeEm(db, s.a.id, s.qa.id, h(8));                                  // borda: conta
  await clipeEm(db, s.a.id, s.qa.id, h(9), { status: "parcial" });           // conta
  await clipeEm(db, s.a.id, s.qa.id, h(10));                                 // em fim: não conta (semiaberto)
  await clipeEm(db, s.a.id, s.qa.id, h(9), { status: "pendente" });          // não
  await clipeEm(db, s.a.id, s.qa.id, h(9), { status: "falhou" });            // não
  await clipeEm(db, s.a.id, s.qa.id, h(9), { expiraEmSeg: -10 });            // expirado
  await clipeEm(db, s.a.id, s.qa.id, h(7, 59));                              // antes
  await clipeEm(db, s.a.id, s.qa.id, h(10, 1));                              // depois
  await clipeEm(db, s.a.id, q2.id, h(9));                                    // outra quadra
  await clipeEm(db, s.b.id, s.qb.id, h(9));                                  // outra arena
  const l = await listarReservas(db, s.a.id, {});
  expect(l[0].lances).toBe(2);
});

test("definirAlunosDaReserva troca a lista; exige ao menos um aluno da arena", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, alunoIds: [s.alA.id], inicio: h(8), fim: h(9) }))!;
  expect(await definirAlunosDaReserva(db, s.a.id, r.id, [s.alA2.id, s.alB.id])).toBe(true);
  expect((await listarReservas(db, s.a.id, {}))[0].alunos.map((x) => x.id)).toEqual([s.alA2.id]);
  await expect(definirAlunosDaReserva(db, s.a.id, r.id, [s.alB.id])).rejects.toBeInstanceOf(ErroPainel);
  expect((await listarReservas(db, s.a.id, {}))[0].alunos.map((x) => x.id)).toEqual([s.alA2.id]);
  expect(await definirAlunosDaReserva(db, s.b.id, r.id, [s.alB.id])).toBe(false);
  expect(await definirAlunosDaReserva(db, s.a.id, "lixo", [s.alA.id])).toBe(false);
});

test("removerReserva apaga a reserva e os vínculos; outra arena não afeta", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, alunoIds: [s.alA.id], inicio: h(8), fim: h(9) }))!;
  expect(await removerReserva(db, s.b.id, r.id)).toBe(false);
  expect(await listarReservas(db, s.a.id, {})).toHaveLength(1);
  expect(await removerReserva(db, s.a.id, "lixo")).toBe(false);
  expect(await removerReserva(db, s.a.id, r.id)).toBe(true);
  expect(await removerReserva(db, s.a.id, r.id)).toBe(false);
  expect((await db.query("select 1 from reserva_alunos")).rows).toHaveLength(0);
});

test("remover o aluno o tira das reservas", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  await criarReserva(db, s.a.id, { quadraId: s.qa.id, alunoIds: [s.alA.id, s.alA2.id], inicio: h(8), fim: h(9) });
  expect(await removerAluno(db, s.a.id, s.alA.id)).toBe(true);
  expect((await listarReservas(db, s.a.id, {}))[0].alunos.map((x) => x.id)).toEqual([s.alA2.id]);
});

test("clipe exatamente no fim de uma reserva conta só para a seguinte", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const base = { quadraId: s.qa.id, alunoIds: [s.alA.id] };
  await criarReserva(db, s.a.id, { ...base, inicio: h(8), fim: h(10) });
  await criarReserva(db, s.a.id, { ...base, inicio: h(10), fim: h(12) });
  await clipeEm(db, s.a.id, s.qa.id, h(10));
  const l = await listarReservas(db, s.a.id, {});
  expect(l.find((x) => x.inicio.getTime() === h(10).getTime())?.lances).toBe(1);
  expect(l.find((x) => x.inicio.getTime() === h(8).getTime())?.lances).toBe(0);
});

test("remover o único aluno mantém a reserva sem alunos e os clipes intactos", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  await criarReserva(db, s.a.id, { quadraId: s.qa.id, alunoIds: [s.alA.id], inicio: h(8), fim: h(10) });
  await clipeEm(db, s.a.id, s.qa.id, h(9));
  expect(await removerAluno(db, s.a.id, s.alA.id)).toBe(true);
  const l = await listarReservas(db, s.a.id, {});
  expect(l).toHaveLength(1);
  expect(l[0].alunos).toEqual([]);
  expect(l[0].lances).toBe(1);
  expect((await db.query("select 1 from clipes")).rows).toHaveLength(1);
});

test("remover a reserva não apaga os clipes", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, alunoIds: [s.alA.id], inicio: h(8), fim: h(10) }))!;
  await clipeEm(db, s.a.id, s.qa.id, h(9));
  expect(await removerReserva(db, s.a.id, r.id)).toBe(true);
  expect((await db.query("select 1 from clipes")).rows).toHaveLength(1);
});

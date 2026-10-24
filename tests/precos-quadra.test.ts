import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { definirEsporteQuadra } from "../app/lib/painel";
import { adicionarFaixas, listarFaixas, removerFaixa } from "../app/lib/precos-quadra";
import { novoBanco } from "./db";
import { criarArena, criarQuadra } from "./fixtures";

async function base(db: Db) {
  const a = await criarArena(db, "A");
  const b = await criarArena(db, "B");
  const qa = await criarQuadra(db, a.id);
  const qb = await criarQuadra(db, b.id);
  return { a, b, qa, qb };
}

const contar = async (db: Db, quadraId: string) =>
  Number((await db.query<{ n: number }>("select count(*)::int as n from precos_quadra where quadra_id = $1", [quadraId])).rows[0].n);

test("adiciona a mesma faixa em vários dias", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  expect(await adicionarFaixas(db, a.id, qa.id, [1, 2, 3], { inicio: 8, fim: 12, precoCentavos: 8000 })).toEqual({ ok: true });
  const faixas = await listarFaixas(db, a.id, qa.id);
  expect(faixas.map(({ id: _id, ...f }) => f)).toEqual([
    { diaSemana: 1, inicio: 8, fim: 12, precoCentavos: 8000 },
    { diaSemana: 2, inicio: 8, fim: 12, precoCentavos: 8000 },
    { diaSemana: 3, inicio: 8, fim: 12, precoCentavos: 8000 },
  ]);
  expect(faixas.every((f) => typeof f.id === "string")).toBe(true);
});

test("listarFaixas ordena por dia e início", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  await adicionarFaixas(db, a.id, qa.id, [3], { inicio: 14, fim: 18, precoCentavos: 100 });
  await adicionarFaixas(db, a.id, qa.id, [3, 0], { inicio: 6, fim: 10, precoCentavos: 100 });
  const f = await listarFaixas(db, a.id, qa.id);
  expect(f.map((x) => [x.diaSemana, x.inicio])).toEqual([[0, 6], [3, 6], [3, 14]]);
});

test("sobreposição em um dos dias não grava nenhum", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  await adicionarFaixas(db, a.id, qa.id, [1], { inicio: 10, fim: 14, precoCentavos: 5000 });
  const r = await adicionarFaixas(db, a.id, qa.id, [1, 2], { inicio: 8, fim: 12, precoCentavos: 8000 });
  expect(r).toEqual({ ok: false, erro: "Já existe preço para Segunda entre 8h e 12h." });
  expect(await contar(db, qa.id)).toBe(1);
});

test("encostada é aceita", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  expect(await adicionarFaixas(db, a.id, qa.id, [1], { inicio: 8, fim: 12, precoCentavos: 8000 })).toEqual({ ok: true });
  expect(await adicionarFaixas(db, a.id, qa.id, [1], { inicio: 12, fim: 14, precoCentavos: 9000 })).toEqual({ ok: true });
  expect(await contar(db, qa.id)).toBe(2);
});

test("faixa inválida não grava", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  const r = await adicionarFaixas(db, a.id, qa.id, [1, 2], { inicio: 12, fim: 12, precoCentavos: 8000 });
  expect(r).toEqual({ ok: false, erro: "O fim deve ser depois do início." });
  expect(await adicionarFaixas(db, a.id, qa.id, [], { inicio: 8, fim: 12, precoCentavos: 8000 })).toEqual({
    ok: false,
    erro: "Marque pelo menos um dia.",
  });
  expect((await adicionarFaixas(db, a.id, qa.id, [7], { inicio: 8, fim: 12, precoCentavos: 8000 })).ok).toBe(false);
  expect(await contar(db, qa.id)).toBe(0);
});

test("quadra ou faixa de outra arena", async () => {
  const db = await novoBanco();
  const { a, b, qa, qb } = await base(db);
  expect(await adicionarFaixas(db, a.id, qb.id, [1], { inicio: 8, fim: 12, precoCentavos: 8000 })).toEqual({
    ok: false,
    erro: "Quadra não encontrada.",
  });
  expect(await adicionarFaixas(db, a.id, "nao-uuid", [1], { inicio: 8, fim: 12, precoCentavos: 8000 })).toEqual({
    ok: false,
    erro: "Quadra não encontrada.",
  });
  expect(await contar(db, qb.id)).toBe(0);
  expect(await listarFaixas(db, a.id, qb.id)).toEqual([]);

  await adicionarFaixas(db, b.id, qb.id, [1], { inicio: 8, fim: 12, precoCentavos: 8000 });
  const [fb] = await listarFaixas(db, b.id, qb.id);
  expect(await removerFaixa(db, a.id, fb.id)).toBe(false);
  expect(await removerFaixa(db, a.id, "nao-uuid")).toBe(false);
  expect(await contar(db, qb.id)).toBe(1);

  await adicionarFaixas(db, a.id, qa.id, [1], { inicio: 8, fim: 12, precoCentavos: 8000 });
  const [fa] = await listarFaixas(db, a.id, qa.id);
  expect(await removerFaixa(db, a.id, fa.id)).toBe(true);
  expect(await contar(db, qa.id)).toBe(0);
});

test("duas faixas sobrepostas ao mesmo tempo: só uma grava", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  const rs = await Promise.all([
    adicionarFaixas(db, a.id, qa.id, [1], { inicio: 8, fim: 12, precoCentavos: 8000 }),
    adicionarFaixas(db, a.id, qa.id, [1], { inicio: 10, fim: 14, precoCentavos: 9000 }),
  ]);
  expect(rs.filter((r) => r.ok)).toHaveLength(1);
  expect(await contar(db, qa.id)).toBe(1);
});

// Pool falso: prova que trava, confere e grava no mesmo cliente, dentro de begin/commit.
test("no pg.Pool, trava a quadra e grava na mesma transação; erro faz rollback", async () => {
  const log: string[] = [];
  const releases: unknown[] = [];
  const quadraId = "00000000-0000-4000-8000-000000000001";
  const arenaId = "00000000-0000-4000-8000-000000000002";
  const db = {
    query: async () => { throw new Error("não deveria usar o pool direto"); },
    async connect() {
      return {
        async query(sql: string) {
          log.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
          if (/for no key update/.test(sql)) return { rows: [{ id: quadraId }] };
          if (/^insert/.test(sql.trim())) throw new Error("boom");
          return { rows: [] };
        },
        release(err?: unknown) { releases.push(err); },
      };
    },
  } as unknown as Db;
  await expect(adicionarFaixas(db, arenaId, quadraId, [1], { inicio: 8, fim: 12, precoCentavos: 100 })).rejects.toThrow("boom");
  expect(log[0]).toBe("begin");
  expect(log.at(-1)).toBe("rollback");
  expect(log.some((l) => l.startsWith("insert"))).toBe(true);
  expect(releases).toHaveLength(1);
  expect(releases[0]).toBeInstanceOf(Error);
});

test("definirEsporteQuadra", async () => {
  const db = await novoBanco();
  const { a, qa, qb } = await base(db);
  expect(await definirEsporteQuadra(db, a.id, qa.id, " Beach tennis ")).toBe(true);
  const esporte = async (id: string) =>
    (await db.query<{ esporte: string }>("select esporte from quadras where id = $1", [id])).rows[0].esporte;
  expect(await esporte(qa.id)).toBe("Beach tennis");
  expect(await definirEsporteQuadra(db, a.id, qa.id, "x".repeat(41))).toBe(false);
  expect(await esporte(qa.id)).toBe("Beach tennis");
  expect(await definirEsporteQuadra(db, a.id, qb.id, "Futevôlei")).toBe(false);
  expect(await esporte(qb.id)).toBe("");
  expect(await definirEsporteQuadra(db, a.id, qa.id, "   ")).toBe(true);
  expect(await esporte(qa.id)).toBe("");
});

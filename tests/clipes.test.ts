import { expect, test, vi } from "vitest";
import type { Db } from "../app/lib/db";
import { clipesDaQuadra } from "../app/lib/clipes";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

const r2Falso = () => ({ urlLeitura: vi.fn(async (chave: string) => `https://r2.exemplo/${chave}?assinado`) });

async function montar(db: Db, arenaId?: string) {
  const arena = arenaId ? { id: arenaId } : await criarArena(db);
  const quadra = await criarQuadra(db, arena.id);
  const camera = await criarCamera(db, arena.id, quadra.id);
  const botao = await criarBotao(db, arena.id, quadra.id, camera.id);
  return { arena, quadra, camera, botao };
}

// idadeSeg: há quanto tempo foi o aperto; expiraEmSeg: negativo = já expirou.
async function clipe(
  db: Db,
  c: Awaited<ReturnType<typeof montar>>,
  o: { status?: string; idadeSeg?: number; expiraEmSeg?: number; duracao?: number | null } = {},
): Promise<string> {
  const status = o.status ?? "pronto";
  const a = await db.query<{ id: string }>(
    `insert into apertos (arena_id, botao_id, recebido_em)
     values ($1, $2, now() - make_interval(secs => $3)) returning id`,
    [c.arena.id, c.botao.id, o.idadeSeg ?? 10],
  );
  const r = await db.query<{ id: string }>(
    `insert into clipes (arena_id, aperto_id, camera_id, status, duracao, recebido_em, expira_em)
     select arena_id, id, $2, $3, $4, recebido_em, now() + make_interval(secs => $5)
       from apertos where id = $1 returning id`,
    [a.rows[0].id, c.camera.id, status, o.duracao === undefined ? 30 : o.duracao, o.expiraEmSeg ?? 3600],
  );
  const id = r.rows[0].id;
  // Chave em qualquer status: só o filtro de status pode excluir pendente, processando e falhou.
  await db.query("update clipes set chave_r2 = $2 where id = $1", [id, `clipes/${c.arena.id}/${id}.mp4`]);
  return id;
}

test("só pronto e parcial da própria quadra; não aparecem pendente, processando, falhou, expirados nem outra quadra", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const outraDaArena = await montar(db, a.arena.id);
  const outraArena = await montar(db);
  const pronto = await clipe(db, a, { status: "pronto", idadeSeg: 30 });
  const parcial = await clipe(db, a, { status: "parcial", idadeSeg: 20, duracao: 12.5 });
  for (const status of ["pendente", "processando", "falhou"]) await clipe(db, a, { status });
  await clipe(db, a, { status: "pronto", expiraEmSeg: -5 });
  await clipe(db, outraDaArena, { status: "pronto" });
  await clipe(db, outraArena, { status: "pronto" });

  const r = await clipesDaQuadra(db, r2Falso(), a.quadra.slug);
  expect(r?.quadra).toBe("Quadra 1");
  expect(r?.clipes.map((c) => c.id)).toEqual([parcial, pronto]);
  expect(r?.clipes[0]).toMatchObject({ parcial: true, duracao: 12.5 });
  expect(r?.clipes[1]).toMatchObject({ parcial: false, duracao: 30 });
  expect(r?.clipes[0].recebidoEm).toBeInstanceOf(Date);
});

test("ordem decrescente por recebido_em e limite de 50", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const antigo = await clipe(db, a, { idadeSeg: 300 });
  const novo = await clipe(db, a, { idadeSeg: 10 });
  const meio = await clipe(db, a, { idadeSeg: 100 });
  expect((await clipesDaQuadra(db, r2Falso(), a.quadra.slug))?.clipes.map((c) => c.id)).toEqual([novo, meio, antigo]);

  for (let i = 0; i < 52; i++) await clipe(db, a, { idadeSeg: 400 + i });
  const todos = (await clipesDaQuadra(db, r2Falso(), a.quadra.slug))!.clipes;
  expect(todos).toHaveLength(50);
  expect(todos[0].id).toBe(novo);
});

test("URL assinada vem do r2.urlLeitura com a chave do clipe", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipe(db, a);
  const r2 = r2Falso();
  const r = await clipesDaQuadra(db, r2, a.quadra.slug);
  expect(r2.urlLeitura).toHaveBeenCalledTimes(1);
  expect(r2.urlLeitura).toHaveBeenCalledWith(`clipes/${a.arena.id}/${id}.mp4`);
  expect(r?.clipes[0].url).toBe(`https://r2.exemplo/clipes/${a.arena.id}/${id}.mp4?assinado`);
});

test("quadra sem clipes devolve lista vazia; slug inexistente devolve null", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  expect(await clipesDaQuadra(db, r2Falso(), a.quadra.slug)).toEqual({ quadra: "Quadra 1", clipes: [] });
  expect(await clipesDaQuadra(db, r2Falso(), "A".repeat(22))).toBeNull();
});

test("slug malformado devolve null sem consultar o banco", async () => {
  const db = { query: vi.fn(() => Promise.reject(new Error("não devia consultar"))) } as unknown as Db;
  const ruins = ["../x", "", "curto", "a".repeat(19), `${"a".repeat(20)}/..`, `${"a".repeat(20)} `, `${"a".repeat(20)}\n`, `${"a".repeat(20)}%`, "é".repeat(22)];
  for (const slug of ruins) {
    expect(await clipesDaQuadra(db, r2Falso(), slug)).toBeNull();
  }
  expect(db.query).not.toHaveBeenCalled();
});

test("nada de dado interno: o resultado só tem os campos públicos", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  await clipe(db, a);
  const r = (await clipesDaQuadra(db, r2Falso(), a.quadra.slug))!;
  expect(Object.keys(r).sort()).toEqual(["clipes", "quadra"]);
  expect(Object.keys(r.clipes[0]).sort()).toEqual(["duracao", "id", "parcial", "recebidoEm", "url"]);
  const publico = { ...r, clipes: r.clipes.map(({ url: _url, ...resto }) => resto) };
  const texto = JSON.stringify(publico);
  for (const proibido of ["chave_r2", "motivo", "camera_id", "arena_id", a.arena.id, a.camera.id, a.quadra.id]) {
    expect(texto).not.toContain(proibido);
  }
});

test("isolamento: cada slug mostra só os clipes da sua quadra", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const b = await montar(db);
  const idA = await clipe(db, a);
  const idB = await clipe(db, b);
  expect((await clipesDaQuadra(db, r2Falso(), a.quadra.slug))?.clipes.map((c) => c.id)).toEqual([idA]);
  expect((await clipesDaQuadra(db, r2Falso(), b.quadra.slug))?.clipes.map((c) => c.id)).toEqual([idB]);
});

import { afterEach, expect, test, vi } from "vitest";
import type { Db } from "../app/lib/db";
import { ErroR2, chaveDaCapa, chaveDoClipe } from "../app/lib/r2";
import { criarHandlerLimpeza, limparExpirados } from "../app/lib/limpeza";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

async function montar(db: Db) {
  const arena = await criarArena(db);
  const quadra = await criarQuadra(db, arena.id);
  const camera = await criarCamera(db, arena.id, quadra.id);
  const botao = await criarBotao(db, arena.id, quadra.id, camera.id);
  return { arena, camera, botao };
}

// Clipe com expira_em deslocado em `expiraEmSeg` do agora (negativo = já expirou).
async function clipe(
  db: Db,
  c: Awaited<ReturnType<typeof montar>>,
  o: { expiraEmSeg: number; status?: string; chave?: string | null | "valida"; idadeSeg?: number },
): Promise<string> {
  const a = await db.query<{ id: string }>(
    `insert into apertos (arena_id, botao_id, recebido_em)
     values ($1, $2, now() - make_interval(secs => $3)) returning id`,
    [c.arena.id, c.botao.id, o.idadeSeg ?? 10],
  );
  const r = await db.query<{ id: string }>(
    `insert into clipes (arena_id, aperto_id, camera_id, status, chave_r2, recebido_em, expira_em)
     select arena_id, id, $2, $3, $4, recebido_em, now() + make_interval(secs => $5)
       from apertos where id = $1 returning id`,
    [a.rows[0].id, c.camera.id, o.status ?? "pronto", o.chave ?? null, o.expiraEmSeg],
  );
  const id = r.rows[0].id;
  // "valida": a chave que o worker grava (clipes/<arena>/<clipe>.mp4).
  if (o.chave === "valida") {
    await db.query("update clipes set chave_r2 = $2 where id = $1", [id, chaveDoClipe(c.arena.id, id)]);
  }
  return id;
}

const ids = async (db: Db) =>
  (await db.query<{ id: string }>("select id from clipes order by id")).rows.map((r) => r.id);

const r2Falso = (falhaEm: string[] = []) => {
  const apagar = vi.fn(async (chave: string) => {
    if (falhaEm.includes(chave)) throw new ErroR2("R2 fora do ar", 0);
  });
  return { apagar };
};

test("apaga no R2 e no banco só os expirados", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const velho = await clipe(db, a, { expiraEmSeg: -60, chave: "valida" });
  const novo = await clipe(db, a, { expiraEmSeg: 3600, chave: "valida" });
  const r2 = r2Falso();
  const res = await limparExpirados(db, r2);
  expect(res).toEqual({ apagados: 1, erros: 0, presos: 0 });
  expect(r2.apagar.mock.calls.map((c) => c[0])).toEqual([
    chaveDoClipe(a.arena.id, velho),
    chaveDaCapa(a.arena.id, velho),
  ]);
  expect(await ids(db)).toEqual([novo]);
});

test("clipe expirado sem chave_r2 (falhou) é apagado sem chamar o R2", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  await clipe(db, a, { expiraEmSeg: -60, status: "falhou", chave: null });
  const r2 = r2Falso();
  expect(await limparExpirados(db, r2)).toEqual({ apagados: 1, erros: 0, presos: 0 });
  expect(r2.apagar).not.toHaveBeenCalled();
  expect(await ids(db)).toEqual([]);
});

test("erro no R2 mantém a linha e segue para os outros; a próxima rodada tenta de novo", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const primeiro = await clipe(db, a, { expiraEmSeg: -120, chave: "valida" });
  await clipe(db, a, { expiraEmSeg: -60, chave: "valida" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const r2 = r2Falso([chaveDoClipe(a.arena.id, primeiro)]);
  expect(await limparExpirados(db, r2)).toEqual({ apagados: 1, erros: 1, presos: 0 });
  expect(await ids(db)).toEqual([primeiro]);
  // R2 volta: a rodada seguinte apaga o que sobrou.
  expect(await limparExpirados(db, r2Falso())).toEqual({ apagados: 1, erros: 0, presos: 0 });
  expect(await ids(db)).toEqual([]);
});

test("falha ao apagar a linha conta como erro e não interrompe a rodada", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  await clipe(db, a, { expiraEmSeg: -120, chave: "valida" });
  await clipe(db, a, { expiraEmSeg: -60, chave: "valida" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  let deletes = 0;
  const envolto: Db = {
    query: (sql, params) => {
      if (/delete\s+from\s+clipes/i.test(sql) && deletes++ === 0) return Promise.reject(new Error("deadlock"));
      return db.query(sql, params);
    },
  };
  const res = await limparExpirados(envolto, r2Falso());
  expect(res).toEqual({ apagados: 1, erros: 1, presos: 0 });
  expect(await ids(db)).toHaveLength(1);
});

test("respeita o limite por rodada", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  // Inseridos do menos antigo para o mais antigo, para a ordem de inserção não ajudar.
  const recente = await clipe(db, a, { expiraEmSeg: -60, chave: "valida" });
  const meio = await clipe(db, a, { expiraEmSeg: -120, chave: "valida" });
  const antigo = await clipe(db, a, { expiraEmSeg: -180, chave: "valida" });
  const r2 = r2Falso();
  const res = await limparExpirados(db, r2, 2);
  expect(res.apagados).toBe(2);
  // Sobra o de expira_em mais recente: os apagados são os mais antigos.
  expect(await ids(db)).toEqual([recente]);
  expect(r2.apagar.mock.calls.map((c) => c[0]).sort()).toEqual(
    [
      chaveDoClipe(a.arena.id, meio), chaveDaCapa(a.arena.id, meio),
      chaveDoClipe(a.arena.id, antigo), chaveDaCapa(a.arena.id, antigo),
    ].sort(),
  );
});

test("chave_r2 diferente de chaveDoClipe conta como erro e não apaga nada (nem R2 nem linha)", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const b = await montar(db);
  const alvo = await clipe(db, a, { expiraEmSeg: -60, chave: "valida" });
  const adulterados = [
    await clipe(db, a, { expiraEmSeg: -61, chave: "clipes/x/qualquer.mp4" }),
    await clipe(db, a, { expiraEmSeg: -62, chave: "valida" }),
    await clipe(db, a, { expiraEmSeg: -63, chave: "valida" }),
  ];
  // Chave de outro clipe da mesma arena e chave que aponta para outra arena.
  await db.query("update clipes set chave_r2 = $2 where id = $1", [adulterados[1], chaveDoClipe(a.arena.id, alvo)]);
  await db.query("update clipes set chave_r2 = $2 where id = $1", [adulterados[2], chaveDoClipe(b.arena.id, adulterados[2])]);
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  const r2 = r2Falso();
  const res = await limparExpirados(db, r2);
  expect(res).toEqual({ apagados: 1, erros: 3, presos: 0 });
  expect(r2.apagar.mock.calls.map((c) => c[0])).toEqual([
    chaveDoClipe(a.arena.id, alvo),
    chaveDaCapa(a.arena.id, alvo),
  ]);
  expect((await ids(db)).sort()).toEqual([...adulterados].sort());
  const log = JSON.stringify(erro.mock.calls);
  for (const id of adulterados) expect(log).toContain(id);
  expect(log).not.toContain("qualquer.mp4");
  expect(log).not.toContain(b.arena.id);
});

test("também roda o reaper e devolve presos", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const preso = await clipe(db, a, { expiraEmSeg: 3600, status: "processando", idadeSeg: 300 });
  const res = await limparExpirados(db, r2Falso());
  expect(res).toEqual({ apagados: 0, erros: 0, presos: 1 });
  const s = await db.query("select status from clipes where id = $1", [preso]);
  expect(s.rows[0].status).toBe("falhou");
});

// --- rota ---

const SEGREDO = "segredo-do-cron-0123456789";
const get = (auth?: string) =>
  new Request("http://x/api/cron/limpeza", { headers: auth === undefined ? {} : { authorization: auth } });

async function rota(o: { segredo?: string; comR2?: boolean } = {}) {
  const segredo = "segredo" in o ? o.segredo : SEGREDO;
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipe(db, a, { expiraEmSeg: -60, chave: "valida" });
  const r2 = r2Falso();
  return { db, r2, chave: chaveDoClipe(a.arena.id, id), handler: criarHandlerLimpeza(db, o.comR2 === false ? null : r2, segredo) };
}

test("rota: 401 sem Bearer, com segredo errado ou de tamanho diferente; nada é apagado", async () => {
  const { db, r2, handler } = await rota();
  const corpos = new Set<string>();
  const tentativas = [
    undefined,
    "",
    "Bearer",
    "Bearer ",
    `Basic ${SEGREDO}`,
    "Bearer errado",
    `Bearer ${SEGREDO}x`,
    `Bearer ${SEGREDO.slice(0, -1)}`,
    `Bearer ${"a".repeat(SEGREDO.length)}`,
  ];
  for (const auth of tentativas) {
    const r = await handler(get(auth));
    expect(r.status).toBe(401);
    expect(r.headers.get("cache-control")).toBe("no-store");
    corpos.add(await r.text());
  }
  expect(corpos.size).toBe(1); // mesma resposta para qualquer erro de segredo
  expect(r2.apagar).not.toHaveBeenCalled();
  expect(await ids(db)).toHaveLength(1);
});

test("rota: 200 com o segredo certo devolve o resultado em JSON", async () => {
  const { db, r2, chave, handler } = await rota();
  const r = await handler(get(`Bearer ${SEGREDO}`));
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(await r.json()).toEqual({ apagados: 1, erros: 0, presos: 0 });
  expect(r2.apagar).toHaveBeenCalledWith(chave);
  expect(await ids(db)).toEqual([]);
});

test("rota: 503 sem CRON_SECRET (nem com Bearer vazio) e 503 sem R2 só depois de autenticar", async () => {
  for (const segredo of [undefined, ""]) {
    const { handler } = await rota({ segredo });
    expect((await handler(get(`Bearer ${SEGREDO}`))).status).toBe(503);
    expect((await handler(get("Bearer "))).status).toBe(503);
  }
  const { handler } = await rota({ comR2: false });
  expect((await handler(get("Bearer errado"))).status).toBe(401);
  expect((await handler(get(`Bearer ${SEGREDO}`))).status).toBe(503);
});

test("rota: falha do banco vira 500 sem vazar mensagem nem o segredo no log", async () => {
  const db = { query: () => Promise.reject(new Error("senha do postgres: segredo123")) } as unknown as Db;
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  const r = await criarHandlerLimpeza(db, r2Falso(), SEGREDO)(get(`Bearer ${SEGREDO}`));
  expect(r.status).toBe(500);
  const texto = await r.text();
  expect(JSON.parse(texto)).toEqual({ erro: "erro interno" });
  expect(texto).not.toContain("segredo123");
  expect(JSON.stringify(erro.mock.calls)).not.toContain(SEGREDO);
});

test("route.ts exporta GET e só config permitida do Next", async () => {
  const mod = await import("../app/api/cron/limpeza/route");
  expect(typeof mod.GET).toBe("function");
  expect(Object.keys(mod).sort()).toEqual(["GET", "dynamic"]);
});

test("falha ao apagar a capa mantém a linha para a próxima rodada", async () => {
  const db = await novoBanco();
  const a = await montar(db);
  const id = await clipe(db, a, { expiraEmSeg: -60, chave: "valida" });
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await limparExpirados(db, r2Falso([chaveDaCapa(a.arena.id, id)]));
  expect(res).toEqual({ apagados: 0, erros: 1, presos: 0 });
  expect(await ids(db)).toEqual([id]);
  erro.mockRestore();
});

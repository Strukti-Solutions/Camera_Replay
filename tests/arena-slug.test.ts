import { expect, test, vi } from "vitest";
import { arenaDoSlug, slugDaArena, slugDaArenaDaQuadra } from "../app/lib/arena-slug";
import { novoBanco } from "./db";
import { criarArena, criarQuadra } from "./fixtures";

async function cenario(db: Awaited<ReturnType<typeof novoBanco>>) {
  const a = await criarArena(db, "Arena A"), b = await criarArena(db, "Arena B");
  const qa = await criarQuadra(db, a.id), qa2 = await criarQuadra(db, a.id), qb = await criarQuadra(db, b.id);
  return { a, b, qa, qa2, qb };
}

test("arenaDoSlug devolve id, nome e se a arena está ativa; slug malformado não consulta o banco", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  expect(await arenaDoSlug(db, s.a.slug)).toEqual({ arenaId: s.a.id, nome: "Arena A", ativa: true });
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [s.b.id]);
  expect(await arenaDoSlug(db, s.b.slug)).toEqual({ arenaId: s.b.id, nome: "Arena B", ativa: false });
  expect(await arenaDoSlug(db, "A".repeat(22))).toBeNull();
  const espiao = vi.spyOn(db, "query");
  for (const ruim of ["curto", "../x", "", "a b".repeat(10), 42 as unknown as string]) expect(await arenaDoSlug(db, ruim)).toBeNull();
  expect(espiao).not.toHaveBeenCalled();
});

test("slugDaArenaDaQuadra leva o slug da quadra ao da sua arena; desconhecido e malformado dão null", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  expect(await slugDaArenaDaQuadra(db, s.qa.slug)).toBe(s.a.slug);
  expect(await slugDaArenaDaQuadra(db, s.qa2.slug)).toBe(s.a.slug);
  expect(await slugDaArenaDaQuadra(db, s.qb.slug)).toBe(s.b.slug);
  expect(await slugDaArenaDaQuadra(db, "A".repeat(22))).toBeNull();
  expect(await slugDaArenaDaQuadra(db, "../x")).toBeNull();
});

test("slugDaArena devolve o slug da arena do painel; id inválido não consulta o banco", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  expect(await slugDaArena(db, s.a.id)).toBe(s.a.slug);
  expect(await slugDaArena(db, s.b.id)).toBe(s.b.slug);
  expect(await slugDaArena(db, "0b8f4a52-3c1e-4d7a-9f00-1a2b3c4d5e6f")).toBeNull();
  const espiao = vi.spyOn(db, "query");
  for (const ruim of ["", "x", "1 or 1=1", 42 as unknown as string]) expect(await slugDaArena(db, ruim)).toBeNull();
  expect(espiao).not.toHaveBeenCalled();
});

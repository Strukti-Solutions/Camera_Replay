import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import {
  apagarFoto, capaDaArena, capasDasQuadras, extensaoDoTipo, fotoParaServir, listarFotos, moverFoto, reservarFoto,
  tipoDaImagem, usarComoCapa,
} from "../app/lib/fotos";
import { novoBanco } from "./db";
import { criarArena, criarQuadra } from "./fixtures";

const bytes = (...b: number[]) => new Uint8Array(b);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBPVP8 ")]);

test("tipo da imagem vem dos primeiros bytes, não do nome", () => {
  expect(tipoDaImagem(JPEG)).toBe("image/jpeg");
  expect(tipoDaImagem(PNG)).toBe("image/png");
  expect(tipoDaImagem(WEBP)).toBe("image/webp");
  expect(tipoDaImagem(new Uint8Array(Buffer.from("<html><script>alert(1)</script>")))).toBeNull();
  expect(tipoDaImagem(new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull();
  expect(tipoDaImagem(new Uint8Array(Buffer.from("RIFF1234WAVEfmt ")))).toBeNull();
  expect(tipoDaImagem(bytes(0xff, 0xd8))).toBeNull();
  expect(tipoDaImagem(new Uint8Array())).toBeNull();
  expect(extensaoDoTipo("image/jpeg")).toBe("jpg");
  expect(extensaoDoTipo("image/png")).toBe("png");
  expect(extensaoDoTipo("image/webp")).toBe("webp");
});

async function base(db: Db) {
  const arena = await criarArena(db, "Arena A");
  const quadra = await criarQuadra(db, arena.id);
  return { arena, quadra };
}

async function reservar(db: Db, arenaId: string, quadraId: string | null, tipo = "image/webp" as const) {
  const r = await reservarFoto(db, arenaId, quadraId, tipo, 1000);
  if (!r.ok) throw new Error(r.erro);
  return r;
}

const ids = async (db: Db, arenaId: string, quadraId: string | null) =>
  (await listarFotos(db, arenaId, quadraId)).map((f) => f.id);

test("reservar foto gera id e chave por arena, na próxima posição", async () => {
  const db = await novoBanco();
  const { arena, quadra } = await base(db);
  const a = await reservar(db, arena.id, null);
  expect(a.chave).toBe(`fotos/${arena.id}/${a.id}.webp`);
  const q = await reservar(db, arena.id, quadra.id, "image/jpeg");
  expect(q.chave).toBe(`fotos/${arena.id}/${q.id}.jpg`);
  const q2 = await reservar(db, arena.id, quadra.id, "image/png");
  expect(await listarFotos(db, arena.id, quadra.id)).toEqual([
    { id: q.id, tipo: "image/jpeg", bytes: 1000, posicao: 0 },
    { id: q2.id, tipo: "image/png", bytes: 1000, posicao: 1 },
  ]);
  expect(await ids(db, arena.id, null)).toEqual([a.id]);
});

test("limites: 10 por arena e 6 por quadra", async () => {
  const db = await novoBanco();
  const { arena, quadra } = await base(db);
  for (let i = 0; i < 10; i++) await reservar(db, arena.id, null);
  expect(await reservarFoto(db, arena.id, null, "image/webp", 1)).toEqual({ ok: false, erro: "A arena já tem 10 fotos." });
  for (let i = 0; i < 6; i++) await reservar(db, arena.id, quadra.id);
  expect(await reservarFoto(db, arena.id, quadra.id, "image/webp", 1)).toEqual({ ok: false, erro: "A quadra já tem 6 fotos." });
});

test("dois envios ao mesmo tempo com a quadra em 5 fotos: só um grava", async () => {
  const db = await novoBanco();
  const { arena, quadra } = await base(db);
  for (let i = 0; i < 5; i++) await reservar(db, arena.id, quadra.id);
  const rs = await Promise.all([
    reservarFoto(db, arena.id, quadra.id, "image/webp", 1),
    reservarFoto(db, arena.id, quadra.id, "image/webp", 1),
  ]);
  expect(rs.filter((r) => r.ok)).toHaveLength(1);
  expect((await listarFotos(db, arena.id, quadra.id)).map((f) => f.posicao)).toEqual([0, 1, 2, 3, 4, 5]);
});

test("quadra de outra arena ou ids que não são uuid se comportam como inexistentes", async () => {
  const db = await novoBanco();
  const { arena, quadra } = await base(db);
  const outra = await criarArena(db, "B");
  expect(await reservarFoto(db, outra.id, quadra.id, "image/webp", 1)).toEqual({ ok: false, erro: "Quadra não encontrada." });
  expect(await reservarFoto(db, "x", null, "image/webp", 1)).toEqual({ ok: false, erro: "Arena não encontrada." });
  expect(await reservarFoto(db, arena.id, "x", "image/webp", 1)).toEqual({ ok: false, erro: "Quadra não encontrada." });
  const f = await reservar(db, arena.id, quadra.id);
  expect(await listarFotos(db, outra.id, quadra.id)).toEqual([]);
  expect(await moverFoto(db, outra.id, f.id, 1)).toBe(false);
  expect(await usarComoCapa(db, outra.id, f.id)).toBe(false);
  let chamou = false;
  expect(await apagarFoto(db, async () => { chamou = true; }, outra.id, f.id)).toBe(false);
  expect(chamou).toBe(false);
  expect(await apagarFoto(db, async () => {}, arena.id, "nao-e-uuid")).toBe(false);
  expect(await ids(db, arena.id, quadra.id)).toEqual([f.id]);
});

test("mover troca com a vizinha e nas pontas não faz nada; capa vai para o início", async () => {
  const db = await novoBanco();
  const { arena, quadra } = await base(db);
  const [a, b, c] = [await reservar(db, arena.id, quadra.id), await reservar(db, arena.id, quadra.id), await reservar(db, arena.id, quadra.id)];
  expect(await moverFoto(db, arena.id, a.id, -1)).toBe(false);
  expect(await moverFoto(db, arena.id, c.id, 1)).toBe(false);
  expect(await moverFoto(db, arena.id, a.id, 1)).toBe(true);
  expect(await ids(db, arena.id, quadra.id)).toEqual([b.id, a.id, c.id]);
  expect(await usarComoCapa(db, arena.id, c.id)).toBe(true);
  expect(await ids(db, arena.id, quadra.id)).toEqual([c.id, b.id, a.id]);
  expect((await listarFotos(db, arena.id, quadra.id)).map((f) => f.posicao)).toEqual([0, 1, 2]);
  // Fotos da arena não se misturam com as da quadra.
  const x = await reservar(db, arena.id, null);
  expect(await moverFoto(db, arena.id, x.id, -1)).toBe(false);
  expect(await ids(db, arena.id, null)).toEqual([x.id]);
});

test("apagar: R2 primeiro; se ele falha a linha fica; depois renumera sem buracos", async () => {
  const db = await novoBanco();
  const { arena, quadra } = await base(db);
  const [a, b, c] = [await reservar(db, arena.id, quadra.id), await reservar(db, arena.id, quadra.id), await reservar(db, arena.id, quadra.id)];
  await expect(apagarFoto(db, async () => { throw new Error("R2 fora"); }, arena.id, b.id)).rejects.toThrow("R2 fora");
  expect(await ids(db, arena.id, quadra.id)).toEqual([a.id, b.id, c.id]);
  const apagadas: string[] = [];
  expect(await apagarFoto(db, async (k) => { apagadas.push(k); }, arena.id, b.id)).toBe(true);
  expect(apagadas).toEqual([b.chave]);
  expect((await listarFotos(db, arena.id, quadra.id)).map((f) => [f.id, f.posicao])).toEqual([[a.id, 0], [c.id, 1]]);
  expect(await moverFoto(db, arena.id, c.id, -1)).toBe(true);
  expect(await ids(db, arena.id, quadra.id)).toEqual([c.id, a.id]);
});

test("foto para servir e capas", async () => {
  const db = await novoBanco();
  const { arena, quadra } = await base(db);
  const sem = await criarQuadra(db, arena.id);
  expect(await capaDaArena(db, arena.id)).toBeNull();
  expect(await capasDasQuadras(db, arena.id)).toEqual(new Map());
  const a1 = await reservar(db, arena.id, null);
  const a2 = await reservar(db, arena.id, null);
  const q1 = await reservar(db, arena.id, quadra.id, "image/png");
  const q2 = await reservar(db, arena.id, quadra.id);
  expect(await capaDaArena(db, arena.id)).toBe(a1.id);
  await usarComoCapa(db, arena.id, q2.id);
  await usarComoCapa(db, arena.id, a2.id);
  expect(await capaDaArena(db, arena.id)).toBe(a2.id);
  expect(await capasDasQuadras(db, arena.id)).toEqual(new Map([[quadra.id, q2.id]]));
  expect((await capasDasQuadras(db, arena.id)).has(sem.id)).toBe(false);
  expect(await capasDasQuadras(db, "x")).toEqual(new Map());
  expect(await fotoParaServir(db, q1.id)).toEqual({ chave: q1.chave, tipo: "image/png" });
  expect(await fotoParaServir(db, "nao-e-uuid")).toBeNull();
  expect(await fotoParaServir(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
});

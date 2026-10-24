import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { atualizarArenaDono, dadosArenaDono, validarEndereco, type EnderecoArena } from "../app/lib/arena-dono";
import type { Geocodificar } from "../app/lib/geocodificar";
import { novoBanco } from "./db";
import { criarArena } from "./fixtures";

const end: EnderecoArena = { rua: "Rua A", numero: "10", bairro: "Centro", cidade: "Fortaleza", uf: "CE", cep: "60000000" };
const achou: Geocodificar = async () => ({ latitude: -3.7, longitude: -38.5 });
const coords = async (db: Db, id: string) =>
  (await db.query("select latitude, longitude, nome, endereco_rua from arenas where id = $1", [id])).rows[0];

test("validarEndereco normaliza e rejeita", () => {
  const r = validarEndereco({ ...end, cep: "60000-000", uf: "ce", rua: "  Rua A " });
  expect(r).toEqual({ ok: true, endereco: end });
  expect(validarEndereco({ ...end, uf: "XX" }).ok).toBe(false);
  expect(validarEndereco({ ...end, cep: "6000000" }).ok).toBe(false);
  expect(validarEndereco({ ...end, rua: " " }).ok).toBe(false);
  expect(validarEndereco({ ...end, bairro: "" }).ok).toBe(true);
});

test("salva endereço e coordenadas", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  const r = await atualizarArenaDono(db, a.id, { nome: "Nova", endereco: end }, achou);
  expect(r).toEqual({ ok: true, localizada: true });
  expect(await coords(db, a.id)).toMatchObject({ latitude: -3.7, longitude: -38.5, nome: "Nova", endereco_rua: "Rua A" });
  const d = await dadosArenaDono(db, a.id);
  expect(d).toEqual({ nome: "Nova", endereco: end, temCoordenadas: true });
});

test("geocodificador sem resultado: salva sem coordenadas e apaga as antigas", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  await atualizarArenaDono(db, a.id, { nome: "A", endereco: end }, achou);
  const r = await atualizarArenaDono(db, a.id, { nome: "A", endereco: { ...end, numero: "99" } }, async () => null);
  expect(r).toEqual({ ok: true, localizada: false });
  expect(await coords(db, a.id)).toMatchObject({ latitude: null, longitude: null, endereco_rua: "Rua A" });
});

test("geocodificador que lança também salva sem coordenadas", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  const r = await atualizarArenaDono(db, a.id, { nome: "A", endereco: end }, async () => { throw new Error("x"); });
  expect(r).toEqual({ ok: true, localizada: false });
});

test("endereço igual não chama o geocodificador de novo", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  let n = 0;
  const g: Geocodificar = async () => { n++; return { latitude: 1, longitude: 2 }; };
  await atualizarArenaDono(db, a.id, { nome: "A", endereco: end }, g);
  const r = await atualizarArenaDono(db, a.id, { nome: "B", endereco: end }, g);
  expect(n).toBe(1);
  expect(r).toEqual({ ok: true, localizada: true });
});

test("arena de outra sessão / uuid malformado não muda nada", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  const inexistente = "00000000-0000-4000-8000-000000000000";
  expect((await atualizarArenaDono(db, inexistente, { nome: "X", endereco: end }, achou)).ok).toBe(false);
  expect((await atualizarArenaDono(db, "x'; --", { nome: "X", endereco: end }, achou)).ok).toBe(false);
  expect(await dadosArenaDono(db, "lixo")).toBeNull();
  expect(await dadosArenaDono(db, inexistente)).toBeNull();
  expect(await coords(db, a.id)).toMatchObject({ nome: "A", endereco_rua: null });
});

test("nome inválido é recusado", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  expect((await atualizarArenaDono(db, a.id, { nome: " ", endereco: end }, achou)).ok).toBe(false);
  expect((await atualizarArenaDono(db, a.id, { nome: "x".repeat(81), endereco: end }, achou)).ok).toBe(false);
});

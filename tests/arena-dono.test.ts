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
  expect(d).toEqual({ nome: "Nova", endereco: end, temCoordenadas: true, coordenadas: { latitude: -3.7, longitude: -38.5 } });
});

test("geocodificador sem resultado: salva sem coordenadas e apaga as antigas", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  await atualizarArenaDono(db, a.id, { nome: "A", endereco: end }, achou);
  await db.query("update arenas set geocodificacao_tentada_em = now() - interval '61 seconds' where id = $1", [a.id]);
  const r = await atualizarArenaDono(db, a.id, { nome: "A", endereco: { ...end, numero: "99" } }, async () => null);
  expect(r).toEqual({ ok: true, localizada: false, motivo: "nao_encontrado" });
  expect(await coords(db, a.id)).toMatchObject({ latitude: null, longitude: null, endereco_rua: "Rua A" });
});

test("geocodificador que lança também salva sem coordenadas", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  const r = await atualizarArenaDono(db, a.id, { nome: "A", endereco: end }, async () => { throw new Error("x"); });
  expect(r).toEqual({ ok: true, localizada: false, motivo: "nao_encontrado" });
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

test("bairro vazio não deixa vírgulas vazias na consulta", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  let q = "";
  await atualizarArenaDono(db, a.id, { nome: "A", endereco: { ...end, bairro: "" } }, async (s) => { q = s; return null; });
  expect(q).not.toContain(", ,");
  expect(q).toBe("Rua A, 10, Fortaleza - CE, 60000000, Brasil");
});

test("save concorrente de outro endereço não recebe as coordenadas do endereço antigo", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  const enderecoB = { ...end, rua: "Rua B", numero: "20" };
  const geoLento: Geocodificar = async () => {
    // Antes de devolver as coordenadas de A, outro save grava B direto no banco
    // (esse save cai no limite de 60 s e não geocodifica; só grava o endereço).
    await atualizarArenaDono(db, a.id, { nome: "A", endereco: enderecoB }, async () => null);
    return { latitude: -3.7, longitude: -38.5 };
  };
  const r = await atualizarArenaDono(db, a.id, { nome: "A", endereco: end }, geoLento);
  expect(r).toEqual({ ok: true, localizada: false, motivo: "nao_encontrado" });
  expect(await coords(db, a.id)).toMatchObject({ latitude: null, longitude: null, endereco_rua: "Rua B" });
});

test("geocodificador no máximo uma vez por minuto por arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  let n = 0;
  const g: Geocodificar = async () => { n++; return null; };
  await atualizarArenaDono(db, a.id, { nome: "A", endereco: end }, g);
  const r = await atualizarArenaDono(db, a.id, { nome: "A", endereco: { ...end, numero: "11" } }, g);
  expect(n).toBe(1);
  expect(r).toEqual({ ok: true, localizada: false, motivo: "limite" });
  expect(await coords(db, a.id)).toMatchObject({ endereco_rua: "Rua A", latitude: null });
  await db.query("update arenas set geocodificacao_tentada_em = now() - interval '61 seconds' where id = $1", [a.id]);
  await atualizarArenaDono(db, a.id, { nome: "A", endereco: { ...end, numero: "12" } }, g);
  expect(n).toBe(2);
});

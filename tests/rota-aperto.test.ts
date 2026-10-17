import { afterEach, expect, test, vi } from "vitest";
import { criarHandlerAperto } from "../app/lib/handler-aperto";
import type { Db } from "../app/lib/db";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

async function cenario() {
  const db = await novoBanco();
  const arena = await criarArena(db);
  const quadra = await criarQuadra(db, arena.id);
  const camera = await criarCamera(db, arena.id, quadra.id);
  const botao = await criarBotao(db, arena.id, quadra.id, camera.id);
  return { db, handler: criarHandlerAperto(db), botao };
}

const post = (auth?: string) =>
  new Request("http://x/api/botao/aperto", {
    method: "POST",
    headers: auth === undefined ? {} : { authorization: auth },
  });

async function esperar401(r: Response) {
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ erro: "token inválido" });
  expect(r.headers.get("cache-control")).toBe("no-store");
}

test("token válido responde 202 com clipe_id e duplicado=false", async () => {
  const { handler, botao } = await cenario();
  const r = await handler(post(`Bearer ${botao.token}`));
  expect(r.status).toBe(202);
  expect(r.headers.get("cache-control")).toBe("no-store");
  const corpo = await r.json();
  expect(corpo.duplicado).toBe(false);
  expect(corpo.clipe_id).toMatch(/^[0-9a-f-]{36}$/);
});

test("segundo POST em seguida responde 202 com duplicado=true e o mesmo clipe", async () => {
  const { handler, botao } = await cenario();
  const a = await (await handler(post(`Bearer ${botao.token}`))).json();
  const r = await handler(post(`Bearer ${botao.token}`));
  expect(r.status).toBe(202);
  expect(await r.json()).toEqual({ clipe_id: a.clipe_id, duplicado: true });
});

test("sem cabeçalho Authorization: 401", async () => {
  const { handler } = await cenario();
  await esperar401(await handler(post()));
});

test("Bearer vazio: 401", async () => {
  const { handler } = await cenario();
  await esperar401(await handler(post("Bearer ")));
  await esperar401(await handler(post("Bearer")));
});

test("token de 42 caracteres: 401", async () => {
  const { handler, botao } = await cenario();
  await esperar401(await handler(post(`Bearer ${botao.token.slice(0, 42)}`)));
});

test("token com espaço no meio ou caracteres fora do alfabeto: 401", async () => {
  const { handler, botao } = await cenario();
  const t = botao.token;
  await esperar401(await handler(post(`Bearer ${t.slice(0, 20)} ${t.slice(20)}`)));
  await esperar401(await handler(post(`Bearer ${t.slice(0, 42)}+`)));
  await esperar401(await handler(post(`Bearer ${t} extra`)));
});

test("token desconhecido (formato válido): 401 igual ao malformado", async () => {
  const { handler } = await cenario();
  await esperar401(await handler(post(`Bearer ${"x".repeat(43)}`)));
});

test("token revogado: 401 com a mesma resposta do inexistente", async () => {
  const { db, handler, botao } = await cenario();
  await db.query("update botoes set revogado_em = now()");
  await esperar401(await handler(post(`Bearer ${botao.token}`)));
});

test("esquema Basic: 401", async () => {
  const { handler, botao } = await cenario();
  await esperar401(await handler(post(`Basic ${botao.token}`)));
  await esperar401(await handler(post("Basic xxx")));
});

test("token malformado não consulta o banco", async () => {
  const query = vi.fn();
  const handler = criarHandlerAperto({ query } as unknown as Db);
  await esperar401(await handler(post("Bearer curto")));
  await esperar401(await handler(post()));
  expect(query).not.toHaveBeenCalled();
});

test("falha do banco: 500 sem vazar a mensagem", async () => {
  const db = { query: () => Promise.reject(new Error("senha do postgres: segredo123")) } as unknown as Db;
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  const token = "a".repeat(43);
  const r = await criarHandlerAperto(db)(post(`Bearer ${token}`));
  expect(r.status).toBe(500);
  const texto = await r.text();
  expect(JSON.parse(texto)).toEqual({ erro: "erro interno" });
  expect(texto).not.toContain("segredo123");
  expect(erro).toHaveBeenCalled();
  expect(JSON.stringify(erro.mock.calls, (_k, v) => (v instanceof Error ? v.message : v))).not.toContain(token);
  expect(r.headers.get("cache-control")).toBe("no-store");
});

// Headers já remove espaços das pontas do valor, então o .trim() do handler não é
// exercitado aqui; o que se cobre é o separador de um ou mais espaços entre "Bearer" e o token.
test("vários espaços entre Bearer e o token são aceitos", async () => {
  const { handler, botao } = await cenario();
  const t = botao.token;
  expect((await handler(post(`  Bearer ${t}  `))).status).toBe(202);
  expect((await handler(post(`Bearer   ${t}`))).status).toBe(202);
});

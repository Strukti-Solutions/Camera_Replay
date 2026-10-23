import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena } from "./fixtures";
import { hashSenha } from "../app/lib/senha";
import { DURACAO_SESSAO_S, criarSessaoDono, sair, validarSessao } from "../app/lib/sessao";
import type { Db } from "../app/lib/db";
import { definirStatusArena } from "../app/lib/plataforma";

// Login (senha, limites, suspensa) fica em entrar-unico.test.ts; aqui, a sessão do dono.

async function preparar() {
  const db = await novoBanco();
  const arena = await criarArena(db, "Arena do Dono");
  const u = await db.query<{ id: string }>(
    "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'dono@x.com', $2, 'dono') returning id",
    [arena.id, await hashSenha("correta-123")],
  );
  return { db, arena, usuarioId: u.rows[0].id };
}

test("criarSessaoDono abre sessão que devolve arena e e-mail", async () => {
  const { db, arena, usuarioId } = await preparar();
  const r = await criarSessaoDono(db, usuarioId, arena.id);
  expect(r.expiraEm.getTime()).toBeGreaterThan(Date.now() + (DURACAO_SESSAO_S - 60) * 1000);
  const s = await validarSessao(db, r.token);
  expect(s).toEqual({ usuarioId, arenaId: arena.id, arenaNome: "Arena do Dono", email: "dono@x.com" });
});

test("sair invalida a sessão e token desconhecido não lança", async () => {
  const { db, arena, usuarioId } = await preparar();
  const r = await criarSessaoDono(db, usuarioId, arena.id);
  await sair(db, r.token);
  expect(await validarSessao(db, r.token)).toBeNull();
  await expect(sair(db, "abc")).resolves.toBeUndefined();
  await expect(sair(db, "a".repeat(43))).resolves.toBeUndefined();
});

test("sessão vencida e token fora do formato dão null", async () => {
  const { db, arena, usuarioId } = await preparar();
  const r = await criarSessaoDono(db, usuarioId, arena.id);
  await db.query("update sessoes set expira_em = now() - interval '1 second'");
  expect(await validarSessao(db, r.token)).toBeNull();
  expect(await validarSessao(db, "abc")).toBeNull();
});

test("token fora do formato não toca no banco", async () => {
  const db = { query: () => { throw new Error("tocou no banco"); } } as unknown as Db;
  expect(await validarSessao(db, "abc")).toBeNull();
  await expect(sair(db, "abc")).resolves.toBeUndefined();
});

test("o banco não guarda o token em claro", async () => {
  const { db, arena, usuarioId } = await preparar();
  const r = await criarSessaoDono(db, usuarioId, arena.id);
  const h = await db.query<{ token_hash: string }>("select token_hash from sessoes");
  expect(h.rows).toHaveLength(1);
  expect(h.rows[0].token_hash).not.toBe(r.token);
  expect(h.rows[0].token_hash).not.toContain(r.token);
});

test("cada sessão nova apaga as sessões vencidas", async () => {
  const { db, arena, usuarioId } = await preparar();
  await criarSessaoDono(db, usuarioId, arena.id);
  await db.query("update sessoes set expira_em = now() - interval '1 hour'");
  await criarSessaoDono(db, usuarioId, arena.id);
  expect((await db.query("select 1 from sessoes")).rows).toHaveLength(1);
});

test("arena suspensa: sessão aberta cai e não revive ao reativar", async () => {
  const { db, arena, usuarioId } = await preparar();
  const aberta = await criarSessaoDono(db, usuarioId, arena.id);
  await definirStatusArena(db, arena.id, "suspensa");
  expect(await validarSessao(db, aberta.token)).toBeNull();
  await definirStatusArena(db, arena.id, "ativa");
  expect(await validarSessao(db, aberta.token)).toBeNull();
});

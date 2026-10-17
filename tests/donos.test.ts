import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArenaComDono } from "../app/lib/donos";
import { entrar } from "../app/lib/sessao";

const SENHA = "senha-bem-longa";

async function contarArenas(db: Awaited<ReturnType<typeof novoBanco>>) {
  return (await db.query<{ n: number }>("select count(*)::int as n from arenas")).rows[0].n;
}

test("cria arena e dono, e o entrar funciona com a senha", async () => {
  const db = await novoBanco();
  const r = await criarArenaComDono(db, { arena: "Arena Sol", email: "  Dono@X.com ", senha: SENHA });
  const u = await db.query<{ arena_id: string; email: string; papel: string }>(
    "select arena_id, email, papel from usuarios where id = $1",
    [r.usuarioId],
  );
  expect(u.rows[0]).toEqual({ arena_id: r.arenaId, email: "dono@x.com", papel: "dono" });
  const s = await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  expect(s.ok).toBe(true);
});

test("senha de 9 caracteres é recusada e não deixa arena", async () => {
  const db = await novoBanco();
  await expect(criarArenaComDono(db, { arena: "A", email: "a@x.com", senha: "123456789" })).rejects.toThrow(
    "senha curta: mínimo 10 caracteres",
  );
  expect(await contarArenas(db)).toBe(0);
});

test("e-mail repetido (com maiúsculas) é recusado e não deixa arena órfã", async () => {
  const db = await novoBanco();
  await criarArenaComDono(db, { arena: "A", email: "a@x.com", senha: SENHA });
  await expect(criarArenaComDono(db, { arena: "B", email: "A@X.COM", senha: SENHA })).rejects.toThrow(
    "e-mail já cadastrado",
  );
  expect(await contarArenas(db)).toBe(1);
});

test("a arena nova já nasce com slug aleatório de 22 caracteres, diferente a cada arena", async () => {
  const db = await novoBanco();
  const a = await criarArenaComDono(db, { arena: "A", email: "a@x.com", senha: SENHA });
  const b = await criarArenaComDono(db, { arena: "B", email: "b@x.com", senha: SENHA });
  const r = await db.query<{ id: string; slug: string }>("select id, slug from arenas");
  const por = Object.fromEntries(r.rows.map((x) => [x.id, x.slug]));
  expect(por[a.arenaId]).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(por[b.arenaId]).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(por[a.arenaId]).not.toBe(por[b.arenaId]);
});

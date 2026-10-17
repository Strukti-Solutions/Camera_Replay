import { expect, test } from "vitest";
import { conferirSenha, hashSenha } from "../app/lib/senha";

test("hashSenha usa o formato scrypt e sal aleatório", async () => {
  const a = await hashSenha("correta-123");
  const b = await hashSenha("correta-123");
  expect(a.startsWith("scrypt$32768$8$1$")).toBe(true);
  expect(a).not.toBe(b);
});

test("conferirSenha aceita a certa e recusa a errada", async () => {
  const h = await hashSenha("correta-123");
  expect(await conferirSenha("correta-123", h)).toBe(true);
  expect(await conferirSenha("outra-senha", h)).toBe(false);
});

test("hash malformado devolve false sem lançar", async () => {
  expect(await conferirSenha("x", "lixo")).toBe(false);
  expect(await conferirSenha("x", "scrypt$1$1$1$x$y")).toBe(false);
  expect(await conferirSenha("x", "")).toBe(false);
});

import { expect, test, vi } from "vitest";
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

test("falha do próprio scrypt devolve false e registra só o código", async () => {
  // N=65536 e r=8 passam na trava de memória (128*N*r = 64 MiB), mas o scrypt
  // precisa de um pouco mais que o maxmem e recusa os parâmetros.
  const hash = `scrypt$65536$8$1$${Buffer.alloc(16, 1).toString("base64")}$${Buffer.alloc(64, 2).toString("base64")}`;
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await conferirSenha("segredo-123", hash)).toBe(false);
    expect(erro).toHaveBeenCalledTimes(1);
    const texto = JSON.stringify(erro.mock.calls);
    expect(texto).toContain("falha no scrypt");
    expect(texto).not.toContain("segredo-123");
    expect(texto).not.toContain(hash);
  } finally {
    erro.mockRestore();
  }
});

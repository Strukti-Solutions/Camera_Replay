import { expect, test, vi } from "vitest";
import type pg from "pg";
import { criarPool } from "../app/lib/db";

test("o pool criado tem listener de error (conexão ociosa derrubada não derruba o processo)", () => {
  const pool = criarPool("postgres://u:senha-secreta@localhost:1/x") as unknown as pg.Pool;
  expect(pool.listenerCount("error")).toBeGreaterThan(0);
});

test("o listener só registra no console, sem a connection string", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const pool = criarPool("postgres://u:senha-secreta@localhost:1/x") as unknown as pg.Pool;
  expect(() => pool.emit("error", new Error("conexão caiu"))).not.toThrow();
  expect(spy).toHaveBeenCalled();
  expect(JSON.stringify(spy.mock.calls)).not.toContain("senha-secreta");
  spy.mockRestore();
});

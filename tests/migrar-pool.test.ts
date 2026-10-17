import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { migrar } from "../db/migrar";
import type { Db } from "../app/lib/db";

// Pool falso: registra em qual cliente cada comando rodou.
function poolFalso(falhaEm?: string) {
  const log: string[] = [];
  const releases: unknown[] = [];
  let proximo = 0;
  const query = async (sql: string) => {
    log.push(`pool:${sql.trim().slice(0, 30)}`);
    return { rows: [] as any[] };
  };
  const db = {
    query,
    async connect() {
      const id = ++proximo;
      return {
        async query(sql: string) {
          log.push(`c${id}:${sql.trim().slice(0, 30)}`);
          if (falhaEm && sql.includes(falhaEm)) throw new Error("falhou");
          return { rows: [] as any[] };
        },
        release(err?: unknown) { log.push(`c${id}:release`); releases.push(err); },
      };
    },
  } as unknown as Db;
  return { db, log, releases };
}

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function pastaCom(sql: string) {
  const p = mkdtempSync(join(tmpdir(), "mig-"));
  pastas.push(p);
  writeFileSync(join(p, "0001_x.sql"), sql);
  return p;
}

test("sem exec, a migração inteira roda num único cliente reservado e o libera", async () => {
  const { db, log, releases } = poolFalso();
  expect(await migrar(db, pastaCom("select 1;"))).toEqual(["0001_x.sql"]);
  const doCliente = log.filter((l) => l.startsWith("c1:"));
  expect(doCliente[0]).toMatch(/begin/);
  expect(doCliente.some((l) => l.includes("schema_migrations"))).toBe(true);
  expect(doCliente.at(-2)).toMatch(/commit/);
  expect(doCliente.at(-1)).toBe("c1:release");
  expect(doCliente.some((l) => l.includes("select 1;"))).toBe(true);
  expect(log.some((l) => l.startsWith("pool:") && /begin|commit/.test(l))).toBe(false);
  expect(releases).toEqual([undefined]);
});

test("se o SQL falha, o rollback vai para o mesmo cliente do begin e ele é liberado", async () => {
  const { db, log, releases } = poolFalso("boom");
  await expect(migrar(db, pastaCom("select boom;"))).rejects.toThrow("falhou");
  const doCliente = log.filter((l) => l.startsWith("c1:"));
  expect(doCliente[0]).toMatch(/begin/);
  expect(doCliente.at(-2)).toMatch(/rollback/);
  expect(doCliente.at(-1)).toBe("c1:release");
  expect(log.some((l) => l.startsWith("pool:") && /rollback/.test(l))).toBe(false);
  expect(releases).toHaveLength(1);
  expect(releases[0]).toBeInstanceOf(Error);
  expect((releases[0] as Error).message).toBe("falhou");
});

test("Db sem exec e sem connect rejeita sem rodar nada", async () => {
  const chamadas: string[] = [];
  const db = {
    async query(sql: string) {
      chamadas.push(sql);
      return { rows: [] as any[] };
    },
  } as unknown as Db;
  await expect(migrar(db, pastaCom("select 1;"))).rejects.toThrow(/exec|connect/);
  expect(chamadas).toEqual([]);
});

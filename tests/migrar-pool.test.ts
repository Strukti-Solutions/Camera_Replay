import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { migrar } from "../db/migrar";
import type { Db } from "../app/lib/db";

// Pool falso: registra em qual cliente cada comando rodou.
function poolFalso(falhaEm?: string) {
  const log: string[] = [];
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
        release() { log.push(`c${id}:release`); },
      };
    },
  } as unknown as Db;
  return { db, log };
}

function pastaCom(sql: string) {
  const p = mkdtempSync(join(tmpdir(), "mig-"));
  writeFileSync(join(p, "0001_x.sql"), sql);
  return p;
}

test("sem exec, a migração inteira roda num único cliente reservado e o libera", async () => {
  const { db, log } = poolFalso();
  expect(await migrar(db, pastaCom("select 1;"))).toEqual(["0001_x.sql"]);
  const doCliente = log.filter((l) => l.startsWith("c1:"));
  expect(doCliente[0]).toMatch(/begin/);
  expect(doCliente.some((l) => l.includes("schema_migrations"))).toBe(true);
  expect(doCliente.at(-2)).toMatch(/commit/);
  expect(doCliente.at(-1)).toBe("c1:release");
});

test("se o SQL falha, o rollback vai para o mesmo cliente do begin e ele é liberado", async () => {
  const { db, log } = poolFalso("boom");
  await expect(migrar(db, pastaCom("select boom;"))).rejects.toThrow("falhou");
  const doCliente = log.filter((l) => l.startsWith("c1:"));
  expect(doCliente[0]).toMatch(/begin/);
  expect(doCliente.at(-2)).toMatch(/rollback/);
  expect(doCliente.at(-1)).toBe("c1:release");
  expect(log.some((l) => l.startsWith("pool:") && /rollback/.test(l))).toBe(false);
});

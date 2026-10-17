import { PGlite } from "@electric-sql/pglite";
import { migrar } from "../db/migrar";
import type { Db } from "../app/lib/db";

// Banco em memória, já migrado.
export async function novoBanco(): Promise<Db> {
  const db = new PGlite() as unknown as Db;
  await migrar(db);
  return db;
}

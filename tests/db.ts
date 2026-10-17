import { PGlite } from "@electric-sql/pglite";
import { afterEach } from "vitest";
import { migrar } from "../db/migrar";
import type { Db } from "../app/lib/db";

// O hook afterEach abaixo é registrado quando este módulo é importado, então
// depende de db.ts ser importado estaticamente (import no topo) pelos testes.
// Todo PGlite criado aqui é fechado após cada teste: instâncias abertas
// acumulavam WASM e derrubavam o worker do Vitest (0xC0000005).
const abertos: PGlite[] = [];

afterEach(async () => {
  const fechar = abertos.splice(0);
  await Promise.all(fechar.map((p) => p.close().catch((e) => console.warn("PGlite: falha ao fechar:", e))));
});

// Banco em memória, já migrado (por padrão com todas as migrações; `pasta`
// permite parar numa versão antiga para testar uma migração com dados).
export async function novoBanco(pasta?: string): Promise<Db> {
  const pg = new PGlite();
  abertos.push(pg);
  await migrar(pg as unknown as Db, pasta);
  return pg as unknown as Db;
}

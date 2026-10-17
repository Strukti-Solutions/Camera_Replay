import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../app/lib/db";

const PASTA_PADRAO = join(dirname(fileURLToPath(import.meta.url)), "migrations");

// Aplica, em ordem alfabética, os .sql ainda não registrados.
export async function migrar(db: Db, pasta = PASTA_PADRAO): Promise<string[]> {
  await db.query(
    `create table if not exists schema_migrations (
       nome text primary key,
       aplicada_em timestamptz not null default now()
     )`,
  );
  const feitas = new Set(
    (await db.query<{ nome: string }>("select nome from schema_migrations")).rows.map((r) => r.nome),
  );
  const aplicadas: string[] = [];
  const arquivos = readdirSync(pasta).filter((f) => f.endsWith(".sql")).sort();
  for (const nome of arquivos) {
    if (feitas.has(nome)) continue;
    const sql = readFileSync(join(pasta, nome), "utf8");
    // Arquivo inteiro numa transação; o registro entra junto. O nome vem do
    // sistema de arquivos, então o escape de aspas basta.
    const nomeSql = nome.split("'").join("''");
    const script = `begin;\n${sql}\ninsert into schema_migrations (nome) values ('${nomeSql}');\ncommit;`;
    try {
      if (db.exec) await db.exec(script);
      else await db.query(script);
    } catch (e) {
      await desfazer(db);
      throw e;
    }
    aplicadas.push(nome);
  }
  return aplicadas;
}

// Melhor esforço: a falha original é a que importa.
async function desfazer(db: Db): Promise<void> {
  try {
    if (db.exec) await db.exec("rollback");
    else await db.query("rollback");
  } catch {
    // sem transação aberta
  }
}

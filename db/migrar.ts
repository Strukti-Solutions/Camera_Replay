import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../app/lib/db";

const PASTA_PADRAO = join(dirname(fileURLToPath(import.meta.url)), "migrations");

// Aplica, em ordem alfabética, os .sql ainda não registrados.
export async function migrar(db: Db, pasta = PASTA_PADRAO): Promise<string[]> {
  if (!db.exec && !db.connect) {
    throw new Error("migrar: o Db precisa de exec (PGlite) ou connect (pg.Pool) para rodar em transação");
  }
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
    const registro = `insert into schema_migrations (nome) values ('${nomeSql}')`;
    if (db.exec) {
      try {
        await db.exec(`begin;
${sql}
${registro};
commit;`);
      } catch (e) {
        await desfazer((s) => db.exec!(s));
        throw e;
      }
    } else {
      // Pool: begin, SQL, registro e commit/rollback têm de usar a mesma conexão.
      const cliente = await db.connect!();
      let erro: Error | undefined;
      try {
        await cliente.query("begin");
        await cliente.query(sql);
        await cliente.query(registro);
        await cliente.query("commit");
      } catch (e) {
        erro = e instanceof Error ? e : new Error(String(e));
        await desfazer((s) => cliente.query(s));
        throw e;
      } finally {
        // Com erro, o pg.Pool descarta a conexão em vez de devolvê-la suja.
        cliente.release(erro);
      }
    }
    aplicadas.push(nome);
  }
  return aplicadas;
}

// Melhor esforço: a falha original é a que importa.
async function desfazer(rodar: (sql: string) => Promise<unknown>): Promise<void> {
  try {
    await rodar("rollback");
  } catch {
    // sem transação aberta
  }
}

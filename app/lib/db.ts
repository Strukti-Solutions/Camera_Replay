import pg from "pg";

// Contrato mínimo de banco: pg.Pool e PGlite satisfazem este tipo.
export type Db = {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  // Roda vários comandos de uma vez (existe no PGlite).
  exec?(sql: string): Promise<unknown>;
  // Reserva uma conexão do pg.Pool (não o connect do pg.Client); necessário para transações.
  // release(erro) faz o pool descartar a conexão.
  connect?(): Promise<{
    query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
    release(err?: Error | boolean): void;
  }>;
  // Transação exclusiva do PGlite (a instância fica reservada até o fim do callback).
  transaction?<R>(fn: (tx: Pick<Db, "query">) => Promise<R>): Promise<R>;
};

// Roda fn numa transação de verdade: no pg.Pool, begin/commit no mesmo cliente
// reservado; no PGlite, a transação exclusiva dele. Erro dentro de fn faz
// rollback e sobe.
export async function emTransacao<R>(db: Db, fn: (tx: Pick<Db, "query">) => Promise<R>): Promise<R> {
  if (db.connect) {
    const cliente = await db.connect();
    let erro: Error | undefined;
    try {
      await cliente.query("begin");
      const r = await fn(cliente);
      await cliente.query("commit");
      return r;
    } catch (e) {
      erro = e instanceof Error ? e : new Error(String(e));
      try {
        await cliente.query("rollback");
      } catch {
        // a falha original é a que importa
      }
      throw e;
    } finally {
      // Com erro, o pool descarta a conexão em vez de devolvê-la suja.
      cliente.release(erro);
    }
  }
  if (db.transaction) return db.transaction(fn);
  throw new Error("emTransacao: o Db precisa de connect (pg.Pool) ou transaction (PGlite)");
}

export function criarPool(url = process.env.DATABASE_URL): Db {
  const pool = new pg.Pool({ connectionString: url });
  // Sem listener, uma conexão ociosa derrubada pelo servidor derruba o processo Node.
  // Registra só a mensagem, nunca a connection string.
  pool.on("error", (err) => console.error("pg.Pool: erro em conexão ociosa:", err.message));
  return pool as unknown as Db;
}

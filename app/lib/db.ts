import pg from "pg";

// Contrato mínimo de banco: pg.Pool e PGlite satisfazem este tipo.
export type Db = {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  // Roda vários comandos de uma vez (existe no PGlite).
  exec?(sql: string): Promise<unknown>;
  // Reserva uma conexão do pg.Pool (não o connect do pg.Client); necessário para transações.
  // release(erro) faz o pool descartar a conexão.
  connect?(): Promise<{ query(sql: string): Promise<unknown>; release(err?: Error | boolean): void }>;
};

export function criarPool(url = process.env.DATABASE_URL): Db {
  const pool = new pg.Pool({ connectionString: url });
  // Sem listener, uma conexão ociosa derrubada pelo servidor derruba o processo Node.
  // Registra só a mensagem, nunca a connection string.
  pool.on("error", (err) => console.error("pg.Pool: erro em conexão ociosa:", err.message));
  return pool as unknown as Db;
}

import pg from "pg";

// Contrato mínimo de banco: pg.Pool e PGlite satisfazem este tipo.
export type Db = {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  // Roda vários comandos de uma vez (existe no PGlite).
  exec?(sql: string): Promise<unknown>;
  // Reserva uma conexão (existe no pg.Pool); necessário para transações.
  connect?(): Promise<{ query(sql: string): Promise<unknown>; release(): void }>;
};

export function criarPool(url = process.env.DATABASE_URL): Db {
  return new pg.Pool({ connectionString: url }) as unknown as Db;
}

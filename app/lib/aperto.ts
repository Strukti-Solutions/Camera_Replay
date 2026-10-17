import type { Db } from "./db";
import { hashToken } from "./segredos";

// Devolve null quando o token é inválido ou foi revogado.
export async function registrarAperto(
  db: Db,
  token: string,
): Promise<{ clipeId: string; duplicado: boolean } | null> {
  const r = await db.query<{ clipe_id: string; duplicado: boolean }>(
    "select * from registrar_aperto($1)",
    [hashToken(token)],
  );
  const linha = r.rows[0];
  return linha ? { clipeId: linha.clipe_id, duplicado: linha.duplicado } : null;
}

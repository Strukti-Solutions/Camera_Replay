import { criarPool, type Db } from "./db";

let pool: Db | undefined;

// Um pool por processo, criado na primeira chamada (preguiçoso: não abre
// conexão até a primeira consulta).
export const poolCompartilhado = (): Db => (pool ??= criarPool());

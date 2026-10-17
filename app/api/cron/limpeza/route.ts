import { criarPool, type Db } from "../../../lib/db";
import { criarHandlerLimpeza } from "../../../lib/limpeza";
import { criarR2, lerConfigR2 } from "../../../lib/r2";

export const dynamic = "force-dynamic";

let pool: Db | undefined;
const poolCompartilhado = () => (pool ??= criarPool());

// GET porque o cron da Vercel chama com GET e Authorization: Bearer <CRON_SECRET>.
// Env lida a cada chamada; o pool só é criado se o segredo estiver configurado.
export const GET = (req: Request) => {
  const config = lerConfigR2();
  const segredo = process.env.CRON_SECRET?.trim();
  // Sem segredo o handler responde 503 antes de qualquer acesso ao banco, mas o
  // pool é preguiçoso: só abre conexão quando a primeira query rodar.
  return criarHandlerLimpeza(poolCompartilhado(), config ? criarR2(config) : null, segredo)(req);
};

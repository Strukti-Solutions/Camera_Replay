import { criarHandlerLembretes, urlDoApp } from "../../../lib/avisos-email";
import { criarEnvioEmail } from "../../../lib/email";
import { poolCompartilhado } from "../../../lib/pool";

export const dynamic = "force-dynamic";

// Lembrete da véspera (cron diário às 21:00 UTC = 18h em São Paulo). GET porque
// o cron da Vercel chama com GET e Authorization: Bearer <CRON_SECRET>.
export const GET = (req: Request) =>
  criarHandlerLembretes(
    poolCompartilhado(), criarEnvioEmail(), urlDoApp(), process.env.CRON_SECRET?.trim(),
  )(req);

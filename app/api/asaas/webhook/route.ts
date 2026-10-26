import { after } from "next/server";
import { asaasDoAmbiente } from "../../../lib/asaas";
import { avisarPagamento, urlDoApp } from "../../../lib/avisos-email";
import { criarEnvioEmail } from "../../../lib/email";
import { criarHandlerWebhookAsaas } from "../../../lib/pagamentos";
import { poolCompartilhado } from "../../../lib/pool";

export const dynamic = "force-dynamic";

// Webhook do Asaas (Checkout e cobranças). Autenticado pelo cabeçalho
// asaas-access-token = ASAAS_WEBHOOK_TOKEN; sem chave ou token responde 503.
// Reserva confirmada: e-mails ao jogador e ao dono depois da resposta.
export const POST = (req: Request) =>
  criarHandlerWebhookAsaas(
    poolCompartilhado(), asaasDoAmbiente(), process.env.ASAAS_WEBHOOK_TOKEN?.trim(), undefined,
    (reservaId) => after(() => avisarPagamento(poolCompartilhado(), reservaId, criarEnvioEmail(), urlDoApp())),
  )(req);

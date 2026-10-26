import { criarAsaas, lerConfigAsaas } from "../../../lib/asaas";
import { criarHandlerWebhookAsaas } from "../../../lib/pagamentos";
import { poolCompartilhado } from "../../../lib/pool";

export const dynamic = "force-dynamic";

// Webhook do Asaas (Checkout e cobranças). Autenticado pelo cabeçalho
// asaas-access-token = ASAAS_WEBHOOK_TOKEN; sem chave ou token responde 503.
export const POST = (req: Request) => {
  const config = lerConfigAsaas();
  return criarHandlerWebhookAsaas(
    poolCompartilhado(), config ? criarAsaas(config) : null, process.env.ASAAS_WEBHOOK_TOKEN?.trim(),
  )(req);
};

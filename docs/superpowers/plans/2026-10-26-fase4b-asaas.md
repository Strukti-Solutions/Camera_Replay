# Plano: fase 4b — pagamento online pelo Asaas

Spec: `docs/superpowers/specs/2026-10-26-pagamento-asaas-design.md`. TDD em cada tarefa; revisão antes de publicar. Nada de chave em teste, log ou commit: o cliente do Asaas recebe `fetch` injetável e os testes usam respostas gravadas (sem rede).

## Tarefas

1. **Migração 0022.**
   - `arenas.asaas_wallet_id` (uuid, nulo = "pagar na arena").
   - Em `reservas`:
     - `asaas_checkout_id`, `asaas_checkout_link`, `asaas_pagamento_id`;
     - `pago_centavos`, `liquido_centavos`, `pago_em`;
     - `estorno` (`solicitado` | `concluido` | `pendente`), `estorno_centavos`.
   - Tabela `asaas_eventos`: `id` text pk, `tipo`, `payload` jsonb, `recebido_em`, `processado_em`, `erro`.
   - **Aceite:** testes de schema; reserva "na arena" continua igual.
2. **Cliente do Asaas (`app/lib/asaas.ts`).**
   - Funções: `criarCheckout`, `cancelarCheckout`, `pagamentosDoCheckout`, `estornar`.
   - URL por `ASAAS_AMBIENTE`; cabeçalho `access_token`.
   - Erros só com status e código do Asaas.
   - **Aceite:** corpo exato do Checkout (split com `percentageValue`, 10 min, sem `customerData`, `externalReference`, callbacks); valores em reais a partir de centavos; a chave nunca aparece em erro.
3. **Admin: carteira da arena.**
   - Campo "Carteira Asaas (walletId)" na página da arena, com formato validado.
   - Guarda de super admin, como as outras actions.
   - **Aceite:** só o super admin altera; em branco volta ao "pagar na arena".
4. **Reserva online.**
   - Arena com carteira e Asaas configurado → `criarReservaOnline`: segurada por 10 min, `pagamento = 'online'`, taxa gravada.
   - Em seguida cria o Checkout, grava id e link e redireciona.
   - Se o Checkout falhar, a reserva é desfeita.
   - O limite de reservas conta as seguradas dentro do prazo.
   - A confirmação mostra o aviso da tarifa e o prazo de 10 min.
   - **Aceite:** arena sem carteira segue no "na arena"; falha no Checkout não deixa o horário preso.
5. **Webhook (`/api/asaas/webhook`).**
   - Token conferido; evento gravado de forma idempotente.
   - Confirmar: segurada → confirmada (mesmo depois do prazo, se o horário estiver livre); ocupado → estorno automático.
   - `PAYMENT_REFUNDED` → estorno concluído.
   - **Aceite:** evento repetido não faz nada; token errado dá 401; evento de reserva desconhecida fica registrado com erro.
6. **Cancelamento com estorno.**
   - Jogador: `value` = líquido, com o split do dono inteiro.
   - Dono: `value` = total, com o split do dono mais a tarifa.
   - Falha → `pendente`.
   - Avisos por e-mail com o valor que volta.
   - **Aceite:** cancelar sem pagamento confirmado (segurada) só libera e cancela o Checkout; estorno pendente aparece no admin.
7. **Telas.**
   - "Minhas reservas": "Aguardando pagamento", com o tempo e o botão Pagar.
   - Cancelamento: o texto diz quanto volta.
   - Agenda do dono: "pago online" ou "na arena".
   - Admin: lista de estornos pendentes.
8. **E-mails:** pagamento confirmado (jogador e dono); o lembrete diz "já pago" quando a reserva é online.
9. **Sandbox de ponta a ponta.**
   - Webhook do sandbox apontando para o ambiente de teste.
   - Pix e cartão pagos no sandbox; cancelamento pelo jogador e pelo dono; pagamento atrasado.
   - Conferir os valores do split e do estorno no extrato.
   - Só então o dono configura a conta real (chave de produção, webhook, carteiras das arenas).

## Pendências do sandbox (antes da tarefa 6 ir ao ar)

- `splitRefunds` pode passar do valor do split (dono pagando a tarifa no cancelamento dele)?
- Os eventos `PAYMENT_*` chegam para a cobrança criada pelo Checkout, e com o `externalReference` da reserva?
- Estorno de Pix com a conta do dono sem saldo: erro 400 ou fica pendente?

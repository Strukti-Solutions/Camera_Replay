# Validação dos estornos Pix pelo nosso site

Emenda da spec `2026-10-26-pagamento-asaas-design.md`, seção do estorno.

**Adiada (26/10/2026).** O dono decidiu começar com a aprovação manual: cada estorno Pix é autorizado no painel do Asaas, com o código por SMS. O de cartão sai sozinho. Esta proposta fica guardada para quando o volume de estornos pedir; antes de construir, é preciso confirmar com o suporte do Asaas as perguntas 1 e 2.

## Problema

Na conta da Strukti, todo estorno pedido pela API espera uma autorização de ação crítica: um código por SMS digitado no painel do Asaas. Sem isso, o estorno é cancelado. A parte do dono (o split) já voltou para a Strukti, e o jogador fica sem o dinheiro.

- O estorno de **cartão** saiu na hora no sandbox, sem pedir autorização.
- O de **Pix** sempre pediu autorização.

O Asaas só dispensa essa autorização com uma de duas proteções:
1. **Lista de IPs** liberados para a chave da API. A Vercel não tem IP fixo, então essa não serve.
2. **Validação por webhook:** o Asaas chama uma URL nossa e só libera a operação se respondermos que ela é legítima.

Esta proposta usa a segunda.

## Como o Asaas valida

Fonte: [Mecanismo para validação de saque via webhooks](https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks).

- **Pedido:** cerca de 5 s depois de cada saque, o Asaas faz um `POST` na URL configurada com `{ "type": "...", "<objeto>": {...} }`.
  - O cabeçalho `asaas-access-token` traz o token que cadastrarmos.
  - Os tipos são `TRANSFER`, `BILL`, `PIX_QR_CODE`, `MOBILE_PHONE_RECHARGE`, e, se ligados à parte, `PIX_REFUND` e `PAYMENT_SPLIT`.
- **No `PIX_REFUND`:** o objeto `pixRefund` traz `payment` (o id da cobrança, `pay_...`) e `value` (o valor do estorno, em reais).
- **Resposta:** `{ "status": "APPROVED" }` ou `{ "status": "REFUSED", "refuseReason": "..." }`.
- **Cancelamento:** a operação é cancelada se a resposta não for uma das duas ou se a chamada falhar 3 vezes seguidas.
- **Onde ligar:** Menu do usuário → Integrações → Mecanismos de segurança, com URL, e-mail para avisos de erro, token e a opção de estornos Pix. Vale também para as subcontas da conta raiz; os donos têm contas próprias, não subcontas, então não são afetados.

## Proposta

Uma rota nova, `POST /api/asaas/validacao`, separada do webhook de eventos.

1. **Token:**
   - O cabeçalho `asaas-access-token` precisa conferir com `ASAAS_VALIDACAO_TOKEN`, comparado em tempo constante como no webhook.
   - É um token diferente do `ASAAS_WEBHOOK_TOKEN`: vazar um não aprova saques com o outro.
   - Sem token configurado, a rota responde 503 e o Asaas cancela. Na dúvida, a regra é sempre recusar.
2. **`PIX_REFUND`:** aprova só se houver uma reserva que cumpra todas as condições abaixo. Caso contrário, recusa com o motivo.
   - `asaas_pagamento_id` igual a `pixRefund.payment`.
   - `situacao = 'cancelada'` e `estorno = 'solicitado'`, ou seja, foi o nosso sistema que pediu.
   - `round(pixRefund.value * 100)` menor ou igual a `estorno_centavos`.
3. **Todos os outros tipos** (transferências, contas, Pix por QR Code, recargas): o sistema nunca faz esses saques, então a regra seria **recusar**. Isso trava os saques manuais da Strukti; ver a pergunta 1.
4. **`PAYMENT_SPLIT`:** fica desligado no painel, porque o split das reservas não precisa de validação.
5. **Registro:** cada pedido gera uma linha numa tabela `asaas_validacoes`, com id, tipo, cobrança, valor, decisão, motivo e data. Dá para auditar e mostrar no admin. Assim como no webhook de eventos, o corpo é limitado a 64 KB.
6. **Erros:**
   - Uma falha de banco responde 503 (o Asaas tenta de novo, até 3 vezes).
   - Um JSON inválido ou um tipo desconhecido é recusado.

O resto do fluxo não muda:
- o estorno aprovado chega pelos eventos `PAYMENT_REFUNDED` ou `PAYMENT_PARTIALLY_REFUNDED`, que já tratamos;
- o recusado chega como `PAYMENT_REFUND_DENIED` e cai em "Pagamentos para resolver".

## Perguntas abertas

1. **Saques manuais da Strukti.** Se ligarmos o mecanismo também para operações feitas pelo painel, o nosso site recusaria os saques da própria Strukti. Opções:
   - **(a) Recomendado:** ligar o mecanismo só para a API e só com estornos Pix; a Strukti continua sacando pelo painel com o SMS. **A confirmar com o Asaas** se dá para separar assim.
   - **(b)** Aprovar `TRANSFER` só para a conta bancária da Strukti, guardada numa variável de ambiente.
2. **O SMS some?** A documentação não diz se ligar a validação dispensa o código de ação crítica. **Precisa ser confirmado com o suporte do Asaas** antes de construir. Se não dispensar, esta proposta não resolve o problema.
3. **Sandbox.** No sandbox, nenhum estorno de Pix saiu: os 4 tentados terminaram cancelados, mesmo com o código do SMS. O mais provável é que um Pix pago pela simulação não tenha para onde devolver. Por isso, o teste final é na conta real, com uma reserva de uns R$ 5 paga com Pix de verdade e cancelada em seguida.

## Testes (TDD)

`tests/validacao-asaas.test.ts`, com PGlite e a rota chamada direto:
- **Token:** ausente ou errado → 401; servidor sem token configurado → 503.
- **Aprovação:** `PIX_REFUND` de reserva cancelada com estorno solicitado e valor igual → `APPROVED`.
- **Recusa de `PIX_REFUND`:**
  - valor maior;
  - cobrança desconhecida;
  - reserva ainda confirmada;
  - estorno já concluído.
- **Outros tipos:** `TRANSFER`, `BILL` e tipo desconhecido → `REFUSED`.
- **Corpo:** acima de 64 KB → 413; JSON inválido → `REFUSED`.
- **Registro:** cada decisão grava uma linha em `asaas_validacoes`.

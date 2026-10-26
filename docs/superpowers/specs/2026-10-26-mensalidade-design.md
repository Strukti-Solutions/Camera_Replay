# Mensalidade do dono pelo Asaas

Emenda da spec `2026-10-22-reservas-publicas-design.md`, item 5 ("Cobrança da mensalidade do dono pelo sistema"). Usa a integração com o Asaas da fase 4b (`2026-10-26-pagamento-asaas-design.md`).

## Decisões do dono (26/10/2026)

- A mensalidade é **opcional por arena**, como a taxa: o super admin informa o valor na tela da arena, e o campo em branco significa sem mensalidade.
- A cobrança é feita por uma **assinatura no Asaas** na conta da Strukti, com o dono como cliente. Todo mês o Asaas manda ao dono, por e-mail, o link para pagar por Pix, boleto ou cartão.
- Quando o dono não paga, aparece um **aviso no admin**. Nada é suspenso sozinho: a Strukti decide se suspende a arena.
- O **dia do vencimento** é escolhido por arena, de 1 a 28.

## Decisões nossas

- O Asaas exige CPF ou CNPJ do cliente. O super admin informa o do dono, junto com o nome que vai na cobrança. O e-mail usado é o do dono da arena.
  - O sistema confere o número pelos dígitos verificadores.
  - O documento fica guardado em `arenas.dono_documento` e não é mostrado fora do admin.
- **Salvar o formulário:**
  - **Valor sem assinatura existente:** cria o cliente, ou reaproveita `asaas_cliente_id`, e depois a assinatura. É mensal, com `billingType UNDEFINED` (o dono escolhe a forma de pagar), `externalReference` igual ao id da arena e `nextDueDate` na próxima data com o dia escolhido, depois de hoje.
  - **Mudou o valor ou o dia:** altera a assinatura com `updatePendingPayments: true`. No sandbox, isso troca o valor da cobrança em aberto, mas não o vencimento dela; o vencimento novo vale a partir da próxima cobrança.
  - **Valor apagado:** exclui a assinatura, e o Asaas apaga as cobranças pendentes.
  - Primeiro chama o Asaas e só depois grava no banco. Se o Asaas falhar, nada muda e o admin vê o erro.
- **Webhook:** é o mesmo endpoint das reservas.
  - Um evento `PAYMENT_*` cuja cobrança tem `subscription` é tratado como mensalidade.
  - A cobrança é sempre lida da API. A arena é achada pelo `subscription` que vem da API, nunca pelo payload.
  - A tabela `mensalidades` guarda uma linha por cobrança, com valor, vencimento, situação, link e data de pagamento.
  - A situação segue o status do Asaas:
    - `PENDING` → pendente;
    - `OVERDUE` → atrasada;
    - `CONFIRMED`, `RECEIVED` e `RECEIVED_IN_CASH` → paga (a baixa manual feita pela Strukti conta);
    - `REFUNDED` → estornada;
    - `PAYMENT_DELETED` → cancelada.
- **Admin:**
  - A lista de arenas ganha a coluna "Mensalidade": valor e situação (em dia, pendente ou **atrasada**).
  - Uma arena com cobrança atrasada aparece também em "Pagamentos para resolver".
  - A tela da arena mostra as últimas 6 cobranças, com o link.

## Fora do escopo

- Suspensão automática.
- Cobrança proporcional (pro rata).
- Desconto.
- O dono ver a mensalidade no painel dele (o Asaas já manda o e-mail com o link).

## Revisão e sandbox (26/10/2026, tarde)

- **Alterar** lê o `nextDueDate` atual da assinatura (`GET /subscriptions/{id}`). Se só o valor mudou, reenvia esse mesmo vencimento. Se o dia mudou, usa o novo dia no mesmo mês do próximo vencimento atual; se essa data já passou, usa o mês seguinte.
- Fatos do sandbox que levaram a essa regra:
  - o PUT sem `nextDueDate` dá HTTP 500;
  - o PUT aceita uma data igual ou anterior à cobrança já gerada, o que faria duas cobranças no mesmo mês;
  - o PUT não move a cobrança pendente.
- **Cadastro concorrente:** a assinatura só é gravada `where asaas_assinatura_id is null`. Quem perde a corrida exclui no Asaas a assinatura que acabou de criar.
- **Webhook:**
  - Cobrança excluída: a API devolve o status antigo com `deleted: true`. O sistema lê esse campo e marca a cobrança como cancelada; o `PAYMENT_DELETED` também passa pela API.
  - Primeira cobrança que chega antes de a assinatura ser gravada: é a cobrança de uma arena que ainda não tem assinatura, criada hoje ou ontem. O webhook responde 503 e o Asaas reenvia.
  - Assinatura que não é do Replay: o evento é ignorado.
- **Excluir com 404** (a assinatura já tinha sido excluída) conta como sucesso.
- **Nome, documento e e-mail** valem no cadastro. Para trocar, a Strukti apaga a mensalidade e cadastra de novo; a tela diz isso.

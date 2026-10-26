# Pesquisa: API do Asaas para a Fase 4 (reserva paga)

Pesquisa feita em 23/10/2026, somente em fontes primárias: docs.asaas.com e asaas.com. As citações entre aspas vêm das páginas indicadas. O que a documentação não confirma está marcado **NÃO CONFIRMADO**.

Design de referência: `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md`, seção "Fase 4".

---

## 1. Autenticação e ambientes

Fonte: <https://docs.asaas.com/docs/autentica%C3%A7%C3%A3o-1>

- **Header:** "Envie a chave no header `access_token`." O Asaas não usa `Authorization: Bearer`. Chave ausente, inválida ou de outro ambiente devolve **401**.
- **URLs base:**

| Ambiente | URL base |
|---|---|
| Sandbox | `https://api-sandbox.asaas.com/v3` |
| Produção | `https://api.asaas.com/v3` |

- **Formato da chave:** em produção começa com `$aact_prod_`; no sandbox, com `$aact_hmlg_`. O `$` faz parte da chave e precisa ser mantido. Chaves de sandbox e de produção são diferentes.
- **Outros headers:** `Content-Type: application/json` e um `User-Agent` que identifique o app. A página do Postman diz que o `User-Agent` é obrigatório para contas raiz criadas a partir de 13/06/2024.
- **Conta sandbox:** `https://sandbox.asaas.com/onboarding/createAccount?customerSignUpOriginChannel=HOME`
- **Validade da chave:** a página não define prazo. Ela só diz para conferir "se não foi desabilitada, expirada ou excluída" (**prazo NÃO CONFIRMADO**).
- **SDK oficial:** a documentação tem guias por linguagem (por exemplo <https://docs.asaas.com/docs/java>). Um SDK oficial para Node/TypeScript **NÃO CONFIRMADO**. Na prática, `fetch` com o header resolve.

## 2. Clientes (customers) e CPF

Fonte: <https://docs.asaas.com/reference/criar-novo-cliente>

- `POST /v3/customers`. Campos obrigatórios no schema: **`name` e `cpfCnpj`**. Opcionais: `email`, `mobilePhone`, `externalReference`, `notificationDisabled`, entre outros.
- **Não dá para criar cliente sem CPF** pela API de clientes, porque `cpfCnpj` é obrigatório no schema. Por isso, "criar o cliente sem CPF e completar depois" não funciona com `/v3/customers`.
- Para buscar um cliente existente, use `GET /v3/customers` com filtros como `cpfCnpj` e `externalReference` (filtros exatos **NÃO CONFIRMADOS** nesta pesquisa). Para atualizar, `PUT /v3/customers/{id}`.
- **`POST /v3/payments` exige `customer`**, que é o id de um cliente. Na prática, uma cobrança direta precisa de um cliente com CPF.
- **Checkout hospedado** (seção 3B): aceita `customer` (id existente), `customerData` (com `cpfCnpj`, que **não** é obrigatório no schema) ou nenhum dos dois. Fonte: <https://docs.asaas.com/docs/how-to-provide-customer-data>. Sem nenhum dos dois, "o pagador informa os próprios dados na tela do Checkout". A documentação não diz se o CPF está entre esses dados (**NÃO CONFIRMADO**, mas é o esperado para Pix e cartão).
- **Conclusão para o design:** pedir o CPF na primeira compra continua válido e é necessário se usarmos `/v3/payments`. Com o Checkout, também é recomendável, para pré-preencher e associar o cliente.

## 3. Cobranças e página de pagamento hospedada

O Asaas oferece dois produtos que atendem a "redirecionar para uma página do Asaas e voltar".

### 3A. Cobrança (`POST /v3/payments`) e `invoiceUrl`

Fonte: <https://docs.asaas.com/reference/criar-nova-cobranca>

- **Obrigatórios:** `customer`, `billingType`, `value`, `dueDate` (data, por exemplo `2017-06-10`).
- **`billingType`:** `UNDEFINED`, `BOLETO`, `CREDIT_CARD`, `PIX`.
- **Outros campos:**
  - `description`: até 500 caracteres.
  - `externalReference`: "campo livre para busca".
  - `split[]`: ver seção 4.
  - `callback`: `successUrl` obrigatório dentro do objeto, até 255 caracteres; `autoRedirect` opcional, padrão `true`.
- **Resposta:** inclui `invoiceUrl`, a "URL da fatura" (exemplo `https://www.asaas.com/i/080225913252`). O pagador vai para essa URL e informa o cartão "na interface do Asaas" (<https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito>). O número do cartão não passa pelo nosso servidor.
- **`UNDEFINED`:** o pagador "poderá escolher entre as formas de pagamento disponíveis" (<https://docs.asaas.com/docs/criando-um-link-de-pagamentos>). As formas disponíveis são as habilitadas na conta, **e isso pode incluir boleto**. Não achamos na documentação como restringir `UNDEFINED` a Pix e cartão (**NÃO CONFIRMADO**).
- **Redirecionamento de volta** (<https://docs.asaas.com/docs/redirecionamento-apos-o-pagamento>):
  - Campos: `callback.successUrl` e `callback.autoRedirect`.
  - Domínio: "A URL deve pertencer ao mesmo domínio cadastrado nos dados comerciais da conta."
  - Alcance: o retorno automático vale para Pix, cartão de crédito e débito pagos na fatura.
  - Com `autoRedirect=false`, aparece o botão "Ir para o site".
  - Reabrir uma fatura já paga não redireciona, a não ser com `?autoRedirect=true`.
  - Não há URL de cancelamento ou de expiração.
- **Validade do QR Pix** (<https://docs.asaas.com/docs/cobrancas-via-pix>): o QR dinâmico "expira 12 meses após a data de vencimento da cobrança". **Não existe validade em minutos** na cobrança. O QR sai de `GET /v3/payments/{id}/pixQrCode`, que devolve `encodedImage` (base64), `payload` (copia e cola) e `expirationDate`. Sem chave Pix cadastrada, o QR "pode ser pago até 23:59 do mesmo dia" (recurso que será descontinuado). A página recomenda manter uma chave Pix cadastrada.
- **Cancelar cobrança não paga** (<https://docs.asaas.com/reference/excluir-cobranca>):
  - Endpoint: `DELETE /v3/payments/{id}`, que responde `{ deleted: true, id }` e dispara o evento `PAYMENT_DELETED`.
  - "A remoção não representa estorno."
  - A cobrança pode ser restaurada (`PAYMENT_RESTORED`).
  - A página não diz se o QR Pix já emitido é invalidado no mesmo instante (**NÃO CONFIRMADO**). Por isso, um pagamento pode chegar perto do momento da exclusão, e o fluxo de "pagamento atrasado → estorno automático" do design continua necessário.
  - Excluir a cobrança apaga a configuração de split. Se ela for restaurada e paga, o split não roda sem ser configurado de novo (<https://docs.asaas.com/docs/split-em-cobrancas-avulsas>).

### 3B. Asaas Checkout (`POST /v3/checkouts`), a opção que melhor atende o design

Fontes: <https://docs.asaas.com/docs/asaas-checkout>, <https://docs.asaas.com/reference/create-new-checkout>, <https://docs.asaas.com/docs/asaas-checkout-faq>

- É uma página hospedada em que o pagador paga com **Pix ou cartão de crédito**.
- **Obrigatórios:** `billingTypes`, `chargeTypes`, `callback`, `items`.
- **Enums e campos:**
  - `billingTypes`: `CREDIT_CARD`, `PIX` (um ou os dois). **Não tem boleto.**
  - `chargeTypes`: `DETACHED`, `RECURRENT`, `INSTALLMENT`. Para a reserva, `DETACHED`.
  - **`minutesToExpire`**: inteiro de **10 a 1440**. Depois disso o link para de funcionar e o status vira `EXPIRED`. Combina com a retenção de 10 minutos.
  - `callback`: `successUrl` e `cancelUrl` obrigatórios, `expiredUrl` opcional.
  - `items[]`: `name` (até 30 caracteres), `quantity`, `value` e `imageBase64` são marcados como obrigatórios; `description` (até 150) e `externalReference` são opcionais.
  - `externalReference`: até 200 caracteres, o "identificador do Checkout no seu sistema".
  - `customer` ou `customerData`: nunca os dois.
  - **`splits[]`**: cada item tem `walletId` e `fixedValue` ou `percentualValue`. O schema de referência escreve `percentageValue`, enquanto o guia escreve `percentualValue` (**nome exato NÃO CONFIRMADO**: testar no sandbox). A resposta usa `split`, sem "s".
- **Resposta:** `id`, `link` e `status` (`ACTIVE`, `CANCELED`, `EXPIRED`, `PAID`). O link do pagador é `https://asaas.com/checkoutSession/show?id=<id>`. A URL equivalente no sandbox **NÃO CONFIRMADO** (usar o `link` da resposta).
- **Cancelar antes de expirar:** `POST /v3/checkouts/{id}/cancel`, que gera `CHECKOUT_CANCELED`.
- **Eventos:** `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED`, `CHECKOUT_EXPIRED`. O payload traz `checkout.id` e **nenhum id de cobrança** (<https://docs.asaas.com/docs/eventos-para-checkout>).
- **Ligação com a cobrança:** o objeto de cobrança tem `checkoutSession`, o "Identificador único do checkout" (<https://docs.asaas.com/reference/recuperar-uma-unica-cobranca>). `GET /v3/payments?checkoutSession=<id>` filtra por ele (<https://docs.asaas.com/reference/listar-cobrancas>). É por esse caminho que se acha o `pay_...` para estornar.
- Não achamos documentado se os eventos `PAYMENT_*` também disparam para a cobrança gerada pelo Checkout (**NÃO CONFIRMADO**; o esperado é que sim, porque a cobrança é uma cobrança normal).
- "Não marque um pedido como pago só porque o pagador chegou à `successUrl`". A confirmação vem do webhook, como já está no design.
- A documentação do Checkout não diz se o callback exige o domínio cadastrado, como acontece na cobrança (**NÃO CONFIRMADO**).

### 3C. Link de pagamento (`POST /v3/paymentLinks`)

O link "permanece ativo para novos pagamentos até ser desabilitado ou removido" e cada preenchimento gera uma nova cobrança. Ele é reutilizável e não tem validade em minutos, então **não serve** para uma reserva de 10 minutos.

## 4. Split

Fontes: <https://docs.asaas.com/docs/split-de-pagamentos>, <https://docs.asaas.com/docs/faq-do-split>, <https://docs.asaas.com/docs/checkout-com-split-de-pagamento>

- **Na cobrança:** `split: [{ walletId, fixedValue? , percentualValue?, totalFixedValue? (só parcelamento), externalReference?, description? }]`. No Checkout, use `splits` (ver 3B).
- **Precisão:** `fixedValue` aceita 2 casas decimais; `percentualValue`, 4.
- **Base de cálculo:** "O Split é calculado sobre o `netValue`, ou seja, o valor da cobrança após o desconto das taxas aplicáveis." O campo `netValue` é o "Valor líquido da cobrança após desconto da tarifa do Asaas".
- **Quem paga a tarifa:** a tarifa sai **antes** da divisão, do valor bruto. O que não for distribuído "permanece na conta que criou a cobrança".
- **Valores fixos e percentuais juntos:** podem ser combinados, sem prioridade entre eles. "O percentual não é calculado sobre o valor restante após os Splits fixos." A soma tem de caber no `netValue`; se não couber, há bloqueio por divergência.
- **Limites:**
  - A soma dos percentuais vai até 100%.
  - "Não há limite de quantidade de `walletId`."
  - Não se pode informar o `walletId` da própria conta emissora (a API devolve erro).
  - Cobranças usadas como garantia de crédito não aceitam split.
  - O split não pode ser configurado pelo site; só pela API (<https://docs.asaas.com/docs/payment-split-overview>).
- **Bloqueio por divergência:** se os valores passarem do líquido no recebimento ou na antecipação, o valor fica bloqueado. Há 2 dias úteis para corrigir; depois disso os splits são cancelados e chega `PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED`.
- **Status do split:** `PENDING`, `PROCESSING`, `PROCESSING_REFUND`, `AWAITING_CREDIT`, `CANCELLED`, `DONE`, `REFUNDED`, `BLOCKED_BY_VALUE_DIVERGENCE`. O guia cita também `REFUSED`, com `refusalReason`.
- **Momento da divisão:** o split só é liquidado quando a cobrança é recebida. No cartão, o recebimento acontece 32 dias depois da confirmação (ver seção 5), então o split fica em `AWAITING_CREDIT` até lá. O evento `PAYMENT_SPLIT_DONE` chega um por split, identificado por `additionalInfo.splitId`.
- **Como obter o `walletId` do dono:**
  1. **Subconta criada pela Strukti:** `POST /v3/accounts` (<https://docs.asaas.com/reference/criar-subconta>).
     - Obrigatórios: `name`, `email`, `cpfCnpj`, `mobilePhone`, `incomeValue`, `address`, `addressNumber`, `province`, `postalCode`. Também `birthDate` para pessoa física e `companyType` (`MEI`, `LIMITED`, `INDIVIDUAL`, `ASSOCIATION`) para pessoa jurídica.
     - A resposta traz `id`, `walletId` e `accessToken.apiKey`. A chave "não poderá ser recuperada posteriormente".
     - **A conta-mãe precisa ser PJ (CNPJ).**
     - KYC: o titular "recebe o e-mail de ativação, define sua senha e envia a documentação pela interface do Asaas" (<https://docs.asaas.com/docs/criacao-de-subcontas>).
     - **Período de avaliação:** até 10 subcontas, cada uma emitindo até R$ 2.000,00 em cobranças, por até 60 dias. Cobranças estornadas não recompõem esse limite. No sandbox, até 20 subcontas por dia.
  2. **Conta Asaas que o dono já tem:** "Cada recebedor deve possuir uma conta Asaas". Nada exige que seja subconta. O `walletId` sai de `GET /v3/wallets/` autenticado **com a chave da conta do dono** (<https://docs.asaas.com/reference/recuperar-walletid>). O guia do WooCommerce cita o menu Integrações do painel. O caminho exato no painel **NÃO CONFIRMADO**.

## 5. Webhooks

Fontes: <https://docs.asaas.com/docs/sobre-os-webhooks>, <https://docs.asaas.com/docs/criar-novo-webhook-pela-api>, <https://docs.asaas.com/docs/tipos-de-envio>, <https://docs.asaas.com/docs/fila-pausada>, <https://docs.asaas.com/docs/webhook-para-cobrancas>

- **Configuração:** pelo painel ou pela API, com `POST /v3/webhooks`.
  - Campos: `name`, `url`, `email`, `enabled`, `interrupted`, `apiVersion`, `authToken`, `sendType`, `events[]`.
  - "Cada conta pode possuir até **10 Webhooks**."
  - A configuração é por conta. Uma subconta pode receber webhooks na criação (campo `webhooks`).
- **Autenticação:** o header **`asaas-access-token`** carrega o `authToken` configurado.
  - O token deve ter entre 32 e 255 caracteres, sem espaços, sem sequências simples, e **não pode ser uma chave de API**.
  - Ele só aparece na resposta da criação; guarde-o.
- **Envio e ordem:**
  - `SEQUENTIALLY` preserva a ordem, mas um evento que falha atrasa os seguintes.
  - `NON_SEQUENTIALLY` não garante ordem.
  - Os dois modos entregam "at least once".
- **Reenvio:** só **HTTP 200** conta como sucesso; 201, 204, 3xx, 4xx, 5xx e timeout são falha. As novas tentativas seguem "intervalos progressivos" (número e tempos **NÃO CONFIRMADOS**). "Após 15 falhas consecutivas, a fila daquela configuração é interrompida." Os eventos continuam guardados por 14 dias e depois "são excluídos permanentemente". A fila é reativada pelo painel ou pela API.
- **Idempotência:** "Persista o `id` recebido e não execute novamente a regra de negócio caso esse identificador já tenha sido processado." O `id` é do tipo `evt_...`. A orientação é responder 200 depois de gravar o evento e processar de forma assíncrona.
- **Formato:** `{ id, event, dateCreated, payment: {...} }`. Nos eventos de Checkout, `{ id, event, dateCreated, account, checkout: {...} }`.
- **Eventos de cobrança que importam:**

| Evento | Significado (citação) |
|---|---|
| `PAYMENT_CREATED` | "Geração de nova cobrança." |
| `PAYMENT_CONFIRMED` | "Pagamento efetuado, mas com saldo ainda não disponibilizado." |
| `PAYMENT_RECEIVED` | "Cobrança recebida, com valor disponível na conta Asaas." |
| `PAYMENT_AWAITING_RISK_ANALYSIS` / `PAYMENT_REPROVED_BY_RISK_ANALYSIS` / `PAYMENT_APPROVED_BY_RISK_ANALYSIS` | análise manual de risco do cartão |
| `PAYMENT_OVERDUE` | "Cobrança vencida." |
| `PAYMENT_DELETED` / `PAYMENT_RESTORED` | removida ou restaurada |
| `PAYMENT_REFUND_IN_PROGRESS` | "Estorno em processamento..." |
| `PAYMENT_REFUNDED` | "Cobrança estornada." |
| `PAYMENT_PARTIALLY_REFUNDED` | "Cobrança estornada parcialmente." |
| `PAYMENT_REFUND_DENIED` | "Estorno negado. Disponível somente para boletos." |
| `PAYMENT_CHARGEBACK_REQUESTED` / `_DISPUTE` / `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` | chargeback |
| `PAYMENT_SPLIT_DONE` / `PAYMENT_SPLIT_CANCELLED` / `PAYMENT_SPLIT_DIVERGENCE_BLOCK(_FINISHED)` | split |
| `PAYMENT_CHECKOUT_VIEWED` | "Fatura da cobrança visualizada pelo cliente." |

- **Pix e cartão seguem caminhos diferentes:**
  - **Pix** em dia vai de `PAYMENT_CREATED` direto para `PAYMENT_RECEIVED`, **sem `PAYMENT_CONFIRMED`**.
  - **Cartão de crédito** passa por `PAYMENT_CONFIRMED`; o `PAYMENT_RECEIVED` vem **32 dias depois** (3 dias no débito).
  - Por isso, **a reserva deve ser confirmada no primeiro dos dois eventos, `CONFIRMED` ou `RECEIVED`**.
- **IPs oficiais:** existe uma lista para liberar no firewall (<https://docs.asaas.com/docs/ips-oficiais-do-asaas>). O conteúdo da lista não foi conferido.

## 6. Estornos

Fonte: <https://docs.asaas.com/reference/estornar-cobranca>

- **Endpoint:** `POST /v3/payments/{id}/refund`, com corpo `{ value?, description?, splitRefunds?: [{ id, value }] }`.
- **Valor estornado:**
  - Sem `value` e sem `splitRefunds`, "o estorno será integral".
  - Só com `splitRefunds`, o total é a soma dos splits.
  - Com `value` e `splitRefunds`, "os valores definidos em splitRefunds são debitados dos respectivos participantes e o restante é debitado da cobrança principal".
- **Pix:** aceita estorno integral ou "múltiplos estornos parciais" até o valor da cobrança.
- **Cartão:** aceita estorno com a cobrança confirmada ou recebida. O cancelamento "pode levar até 10 dias úteis para aparecer na fatura do pagador".
- **Tarifas:** as tarifas da cobrança "não são devolvidas no estorno".
- **Saldo insuficiente:** um estorno integral de Pix logo após o recebimento pode falhar por falta de saldo, com **erro 400**; é preciso deixar saldo suficiente na conta (a da emissora).
- **Split no estorno:** "Quando uma cobrança com Split é estornada, os repasses relacionados também são estornados." As contas que receberam têm a transferência revertida.
  - **NÃO CONFIRMADO:** o que acontece quando a conta do dono não tem saldo para devolver a parte dela (por exemplo, porque já sacou). Não achamos documentação: erro? saldo negativo? débito do resto da emissora?
- **Acompanhamento:** "A resposta da operação não deve ser usada isoladamente". O andamento vem pelos eventos `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_REFUNDED` e `PAYMENT_PARTIALLY_REFUNDED`.
  - Status da cobrança: `REFUND_REQUESTED`, `REFUND_IN_PROGRESS`, `REFUNDED`.
  - Status de cada item em `refunds[]`: `PENDING`, `AWAITING_CRITICAL_ACTION_AUTHORIZATION`, `AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION`, `CANCELLED`, `DONE`.
  - Cada item tem `refundedSplits`.

## 7. Tarifas (página pública, vista em 23/10/2026)

Fonte: <https://www.asaas.com/precos-e-taxas>. A página não tem data; o rodapé diz "© 2026". As tarifas reais da conta ficam em "Menu > Taxas".

| Item | Padrão | Promoção (3 meses após abrir a conta) |
|---|---|---|
| Pix recebido | R$ 1,99 por transação | R$ 0,99 |
| Cartão de crédito à vista | R$ 0,49 + 2,99% | R$ 0,49 + 1,99% |
| Cartão 2–6x | R$ 0,49 + 3,49% | R$ 0,49 + 2,49% |
| Cartão 7–12x | R$ 0,49 + 3,99% | R$ 0,49 + 2,99% |
| Cartão 13–21x | R$ 0,49 + 4,29% | R$ 0,49 + 3,29% |
| Cartão de débito | R$ 0,35 + 1,89% | — |
| Antecipação de cartão à vista | 1,25% ao mês | — |
| Antecipação de cartão parcelado | 1,70% ao mês | — |

- **Mensalidade:** "sem mensalidade", e abrir a conta é grátis.
- **Pix enviado (saque):** grátis para PF; para PJ, 30 por mês grátis e depois R$ 2,00 cada. TED custa R$ 5,00.
- **Subcontas:** "A criação de subcontas pode gerar cobranças de taxas específicas" (ver "Configurações de Conta > Taxas"). Mensalidade de subconta e valor da taxa de criação **NÃO CONFIRMADOS**: não aparecem na página pública.
- **Taxa pelo uso do split:** não aparece na página pública (**NÃO CONFIRMADO**).
- **Inconsistência da própria página:** o FAQ fala em "1,99%" no parcelado, enquanto a tabela mostra de 3,49% a 4,29%.

---

## Conflitos com o design

1. **Quem paga a tarifa do Asaas no split.** O design quer o dono pagando a tarifa e a Strukti recebendo exatamente 5% do bruto (R$ 100 → Strukti R$ 5, dono R$ 95 − tarifa). Mas o split é calculado sobre o `netValue` (já sem a tarifa), e o que sobra fica com a **emissora, que é a Strukti**. Com `percentualValue: 95` para o dono, a Strukti receberia 5% do líquido, menos de R$ 5, e dividiria a tarifa. Para cumprir o design com a Strukti como emissora, o split do dono precisa ser um `fixedValue = netValue_previsto − taxa_Strukti`. Isso exige calcular a tarifa antes de saber a forma de pagamento: Pix (R$ 1,99 ou R$ 0,99) e cartão (R$ 0,49 + %) dão líquidos diferentes. Se o valor passar do líquido real, o dinheiro fica bloqueado por divergência. Com Checkout que aceita Pix **e** cartão, o líquido não é conhecido ao criar a cobrança.
2. **Tarifa não devolvida no estorno.** No estorno integral, o Asaas reverte o split do dono (a parte que ele recebeu, já líquida). O restante para completar o valor do jogador, ou seja a taxa da Strukti **mais a tarifa não devolvida**, sai da **conta da Strukti** ("o restante é debitado da cobrança principal"). O design diz que essa tarifa sai da parte do dono. Com `splitRefunds` dá para tirar mais do dono? Se o valor de `splitRefunds` pode passar do que o split pagou, **NÃO CONFIRMADO**. Por padrão, a Strukti arca com a tarifa no estorno.
3. **Retenção de 10 minutos no Pix por cobrança direta.** O QR de uma cobrança `/v3/payments` vale até 12 meses depois do `dueDate`; não existe validade em minutos. É preciso excluir a cobrança aos 10 minutos (`DELETE`), e ainda assim um pagamento pode chegar no limite. **O Checkout resolve isso** com `minutesToExpire: 10`, o mínimo permitido.
4. **`UNDEFINED` pode mostrar boleto.** Na fatura (`invoiceUrl`), o pagador escolhe entre as formas habilitadas na conta, e isso pode incluir boleto, que leva dias e não combina com 10 minutos. O Checkout limita a `PIX` e `CREDIT_CARD`.
5. **Saque do dono e estorno pendente.** O que acontece quando a subconta do dono não tem saldo para devolver o split está **NÃO CONFIRMADO**. Duas observações:
   - No **cartão**, o split só é liquidado no recebimento, 32 dias depois. Antes disso o dono não tem o dinheiro para sacar, e o estorno tende a funcionar.
   - No **Pix**, o split é liquidado na hora, então o risco do design é real. O erro 400 por saldo insuficiente está documentado para a **conta emissora**.
6. **Conta vinculada exige cuidado.** O design cadastra "a conta Asaas vinculada" no admin. Uma conta já existente funciona, mas o `walletId` só sai pela API com a chave do próprio dono (ou pelo painel dele). A Strukti não consegue buscar sozinha. A subconta criada por API exige **a Strukti como PJ (CNPJ)** e passa pelo período de avaliação (10 subcontas e R$ 2.000 por subconta em até 60 dias).
7. **Confirmação: `PAYMENT_RECEIVED` não basta.** No cartão, ele só chega 32 dias depois. A reserva precisa ser confirmada em `PAYMENT_CONFIRMED` **ou** `PAYMENT_RECEIVED`, ou em `CHECKOUT_PAID` no Checkout. Ainda existe a análise manual de risco (`PAYMENT_AWAITING_RISK_ANALYSIS`), que pode demorar mais que os 10 minutos. Esse caso cai na regra de "pagamento atrasado".
8. **Domínio do `successUrl`.** Na cobrança, o `successUrl` precisa estar no domínio cadastrado nos dados comerciais da conta Strukti. `camera-replay.vercel.app` só funciona se esse for o domínio cadastrado.

## Recomendação

1. **Use o Asaas Checkout** (`POST /v3/checkouts`), não `invoiceUrl`:
   - `billingTypes: ["PIX","CREDIT_CARD"]`, `chargeTypes: ["DETACHED"]`.
   - `minutesToExpire: 10`.
   - `externalReference: <id da reserva>`.
   - `callback.successUrl/cancelUrl/expiredUrl` apontando para `/reservas/<id>`.
   - `customerData` com nome, e-mail e CPF guardados na conta do jogador.
   - `splits` para o `walletId` do dono.

   Guarde `checkout.id` na reserva. Ao receber `CHECKOUT_PAID` ou `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`, ache a cobrança com `GET /v3/payments?checkoutSession=<id>` e guarde o `pay_...` (é ele que vai para o estorno).
2. **Divisão da tarifa:**
   - **(a)** Aceite que a Strukti fique com a taxa percentual sobre o **líquido**: dono com `percentualValue = 100 − taxa`. É simples e nunca diverge, mas muda o exemplo do spec (a Strukti recebe 5% de R$ 98,01, e não R$ 5).
   - **(b)** Para manter "R$ 5 exatos", crie **uma cobrança por forma de pagamento**, com `fixedValue` calculado a partir da tarifa contratada. É mais frágil por causa da promoção e de tarifas que mudam.
   - **(c)** Emita a cobrança **na subconta do dono** (com a chave dela), com split fixo de 5% do bruto para a carteira da Strukti. Assim a tarifa e a perda no estorno ficam naturalmente com o dono. Isso contradiz "a cobrança é da Strukti" e só funciona com subcontas criadas pela Strukti.

   O dono precisa decidir. Teste no sandbox.
3. **Webhook único** em `POST /api/asaas/webhook`:
   - Valide `asaas-access-token` com comparação em tempo constante.
   - Grave `evento(id evt_..., tipo, payload)` com `id` UNIQUE e responda 200.
   - Processe depois, de forma idempotente, por transição de estado da reserva.
   - Use o modo `SEQUENTIALLY`, mas não dependa da ordem.
   - Eventos usados: `CHECKOUT_PAID`, `CHECKOUT_EXPIRED`, `CHECKOUT_CANCELED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_SPLIT_*`.
4. **Retenção de 10 minutos:**
   - A reserva nasce `aguardando_pagamento` com `expira_em = agora + 10 min` e ocupa o horário na regra de não sobreposição.
   - Uma rotina, ou a leitura sob demanda, libera o horário quando `expira_em` passa. Se o Checkout ainda estiver `ACTIVE`, chame `POST /v3/checkouts/{id}/cancel`.
   - Se o pagamento chegar depois de liberado, confirme se o horário estiver livre; senão, estorne automaticamente, como no design.
5. **Estorno:**
   - Chame `POST /v3/payments/{pay}/refund` sem `value` (integral) e marque a reserva `estorno_solicitado`.
   - Só marque `estornada` com `PAYMENT_REFUNDED`.
   - Erro 400 ou estorno que não conclui → `estorno_pendente`, visível no admin.
   - Antes de ir para produção, teste no sandbox o estorno com a subconta do dono sem saldo.
6. **CPF:** continua pedido na primeira compra (necessário para criar cliente e recomendado no Checkout).
7. **Antes de implementar, confirme no sandbox:**
   - nome do campo `percentualValue` × `percentageValue` no Checkout;
   - se os eventos `PAYMENT_*` disparam para a cobrança do Checkout;
   - estorno com o recebedor sem saldo;
   - limite de `splitRefunds`;
   - se o callback do Checkout exige o domínio cadastrado.

---

## Sandbox, 26/10/2026 (testado com a conta sandbox da Strukti, PF)

- Conta PF: `POST /v3/accounts` (criar subconta) responde **403**. Cada dono precisa da própria conta.
- Checkout com Pix exige uma chave Pix cadastrada (`POST /v3/pix/addressKeys {"type":"EVP"}`); a chave nova levou alguns minutos para valer.
- `POST /v3/checkouts` com `PIX` + `CREDIT_CARD`, `DETACHED`, `minutesToExpire: 10` e callbacks em `camera-replay.vercel.app` funcionou **sem domínio cadastrado** na conta.
- Com `customerData` (nome, CPF, e-mail, telefone) o Asaas exige `address`, `addressNumber`, `postalCode` e `province`. **Sem `customerData`** o Checkout é criado e a própria página pede os dados ao pagador.
- O campo do split no Checkout é `percentageValue` (a doc antiga cita `percentualValue`).
- Cobrança Pix de R$ 100,00 → `netValue` R$ 99,01 (tarifa promocional de R$ 0,99).

## Sandbox, 26/10/2026 (tarde): estorno com split

Testes com a segunda conta sandbox fazendo o papel do dono, numa cobrança Pix de R$ 100 com split de 95% (R$ 94,05 ao dono; tarifa R$ 0,99):
- **`splitRefunds` não pode passar do valor do split:** "O valor total estornado do split [R$ 95,04] excede o valor total do split [R$ 94,05]". O dono devolve no máximo o split dele, então a tarifa de um estorno integral sai da Strukti.
- **Estorno integral com o split inteiro funciona.** **Estorno do líquido (R$ 99,01) com o split inteiro também funciona:** a conta da Strukti paga só a parte dela (R$ 4,96).
- **A conta da Strukti precisa de folga de saldo.** Com saldo igual à parte dela, o Asaas respondeu "Saldo insuficiente"; depois de entrar mais dinheiro, o mesmo estorno passou.
- **Logo depois da confirmação, o estorno pode dar 400** com "Não é possível solicitar estorno para essa cobrança no momento. Tente novamente em alguns instantes." Em seguida passou.
- **O estorno pela API ficou com status `AWAITING_CRITICAL_ACTION_AUTHORIZATION`:** a conta exige autorizar ações críticas (token) também nas chamadas da API. Para estornar sozinho, é preciso liberar isso nas configurações de segurança da conta (Integrações), senão cada estorno espera autorização manual no painel.
- A assinatura (mensalidade) foi testada antes: a primeira cobrança é criada na hora; `PUT` com `updatePendingPayments` muda o valor da pendente, mas não o vencimento; `DELETE` apaga as pendentes.

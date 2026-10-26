# Fase 4b: pagamento online pelo Asaas — design

Data: 26/10/2026. Emenda a fase 4 de `2026-10-22-reservas-publicas-design.md` (seções "Fluxo", "Dinheiro" e "Cancelamento"); onde divergem, vale este. Pesquisa da API em `docs/pesquisa/asaas.md` (seção "Sandbox, 26/10" com o que foi testado).

## Decisões do dono (26/10)

- **Tarifa do Asaas no cancelamento pelo jogador:** o jogador **não recebe de volta a tarifa do Asaas** (Pix ou cartão). Ele é avisado disso **antes de pagar** e **antes de confirmar o cancelamento**. Assim nem a Strukti nem o dono pagam a tarifa, e o aviso desestimula cancelar. *(Substitui "recebe o valor inteiro de volta, inclusive a taxa".)*
- **Cancelamento pelo dono:** o jogador recebe **tudo de volta**; a tarifa que o Asaas não devolve sairia da parte do dono, mas o Asaas **não permite** estornar do split mais do que o próprio split (testado no sandbox em 26/10/2026: "O valor total estornado do split excede o valor total do split"). Por isso o dono devolve o split inteiro e **a tarifa fica com a Strukti** (cerca de 1% da reserva). Se for preciso repassar ao dono, dá para somar na mensalidade dele.
- **Por arena:** arena com **conta Asaas vinculada** cobra online; arena sem conta continua no **"pagar na arena"** da fase 4a. *(Substitui "arena sem conta vinculada não recebe reservas pagas".)*
- **A conta da Strukti no Asaas é de pessoa física (CPF)**, então não cria subcontas: **cada dono abre a própria conta Asaas** e informa o identificador da carteira (walletId), que o super admin cadastra na arena.

## Decisões nossas

- **Asaas Checkout** (`POST /v3/checkouts`): Pix e cartão de crédito à vista (`chargeTypes: DETACHED`), validade de **10 minutos** (`minutesToExpire: 10`, o mínimo), `externalReference` = id da reserva, retorno (`successUrl`/`cancelUrl`/`expiredUrl`) para "Minhas reservas". Sem boleto.
- **Sem `customerData`:** a página do Asaas pede nome, CPF e o que mais precisar ao pagador. **Não guardamos CPF.** *(Substitui "CPF pedido na primeira compra".)* Testado no sandbox: com `customerData` o Asaas exige endereço completo; sem ele, o Checkout é criado normalmente.
- **Split** para a carteira do dono com `percentageValue = 100 − taxa_percentual` da arena. O Asaas calcula o split sobre o **valor líquido** (já sem a tarifa), então a Strukti fica com a taxa percentual **do líquido** e a tarifa da venda é dividida na mesma proporção. Ex.: R$ 100 no Pix com tarifa de R$ 0,99 → líquido R$ 99,01 → dono R$ 94,06, Strukti R$ 4,95. *(Substitui "a Strukti recebe exatamente 5% do bruto".)* O painel do dono e o admin mostram o valor bruto e a taxa da Strukti estimada; o valor exato está no extrato do Asaas.
- **Fluxo:** "Reservar" → tela de confirmação (com o aviso da tarifa) → o horário fica **segurado por 10 minutos** (situação `segurada`, já existente) e o site cria o Checkout e redireciona para ele. Se criar o Checkout falhar, a reserva segurada é desfeita na hora e o jogador vê "Não foi possível abrir o pagamento agora".
- **Enquanto segurada:** "Minhas reservas" mostra a reserva como "Aguardando pagamento" com o tempo restante e o botão **Pagar** (volta ao mesmo Checkout). O limite de reservas (2 por arena, 5 no total) conta as seguradas dentro do prazo.
- **Confirmação só pelo webhook** (`POST /api/asaas/webhook`), nunca pelo retorno do navegador:
  - autenticado pelo cabeçalho `asaas-access-token` (comparação em tempo constante com `ASAAS_WEBHOOK_TOKEN`);
  - cada evento é gravado com o `id` do Asaas como chave única (repetido = ignorado, responde 200);
  - eventos que confirmam: `CHECKOUT_PAID`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` (o que chegar primeiro; os outros não fazem nada). O id da cobrança (`pay_…`), o valor e o valor líquido ficam gravados na reserva.
  - `PAYMENT_REFUNDED` marca o estorno como concluído.
- **Pagamento atrasado** (chega depois dos 10 minutos): se o horário ainda está livre, confirma; se não, **estorna automaticamente**, com a mesma regra do cancelamento pelo jogador (sem a tarifa). A tela de pagamento avisa que o prazo é de 10 minutos.
- **Estorno:**
  - pelo jogador e pagamento atrasado: `value` = valor líquido; `splitRefunds` devolve o split inteiro do dono; o resto (a parte da Strukti) sai da conta da Strukti. Ninguém paga a tarifa além do jogador.
  - pelo dono: `value` = valor total; `splitRefunds` tira do dono o split dele **mais** a tarifa.
  - A reserva guarda a situação do estorno: `solicitado` → `concluido` (pelo webhook) ou `pendente` (erro do Asaas, ex.: dono sem saldo). Estorno pendente aparece no admin e a Strukti resolve à mão.
- **Avisos por e-mail:** confirmação de pagamento ao jogador e aviso de reserva paga ao dono; o lembrete diz "já pago" nas reservas online. Os avisos de cancelamento dizem quanto volta e em quanto tempo (Pix: na hora; cartão: até 10 dias úteis na fatura).
- **Ambiente:** `ASAAS_API_KEY`, `ASAAS_AMBIENTE` (`sandbox` ou `producao`) e `ASAAS_WEBHOOK_TOKEN`, só nas variáveis de ambiente. Sem chave, o site continua todo no "pagar na arena".

## Fica para depois

- Parcelamento no cartão, boleto, assinatura.
- O dono escolher aceitar também "pagar na arena" numa arena com conta vinculada.
- Conta PJ da Strukti com subcontas criadas pela API.

## Aprovação manual dos estornos (decisão do dono, 26/10/2026)

O Asaas trata o estorno pedido pela API como evento crítico, e ele fica em `AWAITING_CRITICAL_ACTION_AUTHORIZATION` até alguém aprovar com o token no painel ou no app. Para desligar isso é preciso uma whitelist de IP fixo, e a Vercel não tem. **Por enquanto a Strukti aprova cada estorno à mão.** O jogador vê "Estorno de R$ X solicitado. O dinheiro volta assim que for aprovado.", e o e-mail diz que o estorno passa por aprovação da Strukti. Rever com volume maior: IP fixo na Vercel, ou pedir ao Asaas.

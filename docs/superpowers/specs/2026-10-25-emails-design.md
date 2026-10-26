# E-mails: envio pelo Gmail, avisos de cancelamento e lembrete — design

Data: 25/10/2026. Pedido do dono do projeto: "Faz ai a parte do email. [...] adiciona email de lembrete e de aviso para quando ou o usuario ou o dono cancela um reserva". Complementa `2026-10-22-reservas-publicas-design.md` (Fase 1, envio de e-mail); onde divergem, vale este.

## Envio

- **Pelo SMTP do Gmail** da conta struktisolutions@gmail.com, com senha de app **(decisão do dono)**, no lugar do Resend. Remetente: `Replay <struktisolutions@gmail.com>`.
- Variáveis: `SMTP_USUARIO` (o e-mail) e `SMTP_SENHA` (a senha de app), só no ambiente. Sem as duas, em produção o envio não existe (o "Esqueci a senha" some, como hoje) e os avisos só registram no log que não foram enviados; fora de produção o e-mail aparece no terminal do `next dev`.
- Limite do Gmail: cerca de 500 e-mails por dia. Serve para o começo; quando passar disso, troca-se o transporte (a interface `EnviarEmail` não muda) **(decisão nossa)**.
- Texto puro, sem HTML, sem imagem. Nenhum texto digitado por alguém entra em cabeçalho do e-mail (só no corpo).
- Falha no envio nunca desfaz nem trava a ação (cancelar continua cancelado). O erro vai para o log sem e-mail nem texto da mensagem **(decisão nossa)**.

## Avisos de cancelamento **(decisão nossa, a partir do pedido)**

- **Jogador cancela:** o dono da arena recebe "Reserva cancelada pelo jogador" (quadra, dia, horário, nome do jogador); o jogador recebe a confirmação do cancelamento.
- **Dono cancela uma reserva:** o jogador recebe "Sua reserva foi cancelada pela arena", com o motivo quando houver.
- Remover bloqueio não manda nada (não tem jogador).
- "Dono" = as contas da tabela `usuarios` da arena (hoje uma por arena).
- O envio sai depois da resposta (`after` do Next), para o botão não esperar o Gmail.

## Lembrete **(decisão nossa)**

- Um e-mail ao jogador **na véspera, às 18h** (horário de São Paulo), para cada reserva confirmada que começa no dia seguinte: arena, endereço, quadra, horário, "pagar na arena" e o link de Minhas reservas.
- Roda num cron diário (`/api/cron/lembretes`, 21:00 UTC), protegido pelo `CRON_SECRET` como a limpeza. Cada reserva recebe no máximo um lembrete: a coluna `reservas.lembrete_enviado_em` é marcada antes do envio (quem marca, envia; dois crons ao mesmo tempo não duplicam). Se o envio falhar, a marca volta a nulo e a reserva entra no próximo cron se ainda for véspera.
- Reserva feita depois das 18h para o dia seguinte, ou para o mesmo dia, não recebe lembrete.
- Arena suspensa e conta de jogador apagada não recebem.

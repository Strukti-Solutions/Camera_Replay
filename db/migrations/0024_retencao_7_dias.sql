-- Retenção de lances: padrão e teto de 7 dias (decisão do Thiago em 26/10, Q12/Q22
-- da página do replay: o lance fica 7 dias, como diz o vídeo, inclusive nas
-- arenas que já existem). Desfaz o teto de 3 dias da 0007.
-- Primeiro troca o check e o padrão, depois atualiza os dados existentes.
-- registrar_aperto não muda: já lê arenas.dias_retencao.

alter table arenas drop constraint arenas_dias_retencao_check;
alter table arenas add constraint arenas_dias_retencao_check check (dias_retencao between 1 and 7);
alter table arenas alter column dias_retencao set default 7;

update arenas set dias_retencao = 7;

-- Só os lances ainda guardados: a limpeza apaga a linha quando expira_em < now()
-- e as páginas só mostram expira_em > now(). Um lance já expirado, à espera da
-- limpeza, não volta a aparecer.
update clipes set expira_em = recebido_em + interval '7 days'
 where expira_em > now();

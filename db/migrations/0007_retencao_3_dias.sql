-- Retenção de lances: padrão e teto de 3 dias (decisão do dono em 17/10).
-- Primeiro reduz os dados existentes, depois troca o check e o padrão.
-- registrar_aperto não muda: já lê arenas.dias_retencao.

update arenas set dias_retencao = least(dias_retencao, 3) where dias_retencao > 3;

update clipes set expira_em = recebido_em + interval '3 days'
 where expira_em > recebido_em + interval '3 days';

alter table arenas drop constraint arenas_dias_retencao_check;
alter table arenas add constraint arenas_dias_retencao_check check (dias_retencao between 1 and 3);
alter table arenas alter column dias_retencao set default 3;

-- Fase 1: o e-mail do dono fica sempre em minúsculas, como em jogadores,
-- super_admins e contas_email (o login único busca pelo e-mail normalizado).
-- Produção não tem dono com maiúscula (conferido antes desta migração).
alter table usuarios add constraint usuarios_email_minusculo check (email = lower(email));

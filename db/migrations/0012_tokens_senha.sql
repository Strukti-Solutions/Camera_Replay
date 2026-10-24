-- Fase 1: "Esqueci a senha". Link de uso único, válido por 1 hora, para jogador,
-- dono e admin. conta_id aponta para jogadores, usuarios ou super_admins conforme
-- o tipo (sem chave estrangeira: são três tabelas). O banco guarda só o hash do token.

create table tokens_senha (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('jogador', 'dono', 'admin')),
  conta_id uuid not null,
  token_hash text not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  usado_em timestamptz
);
create index tokens_senha_conta on tokens_senha (tipo, conta_id);

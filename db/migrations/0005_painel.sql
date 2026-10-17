-- Painel do dono: sessões de login, limite de tentativas e data de criação.

-- Sessão do painel. Só o hash do token vai para o banco (o token fica no cookie).
-- A FK composta impede sessão de um usuário numa arena que não é a dele.
create table sessoes (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null,
  usuario_id uuid not null,
  token_hash text not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  foreign key (usuario_id, arena_id) references usuarios (id, arena_id) on delete cascade
);

-- Tentativas de login com falha. É anterior ao login, então não tem arena_id
-- (exceção registrada no spec, seção "Painel do dono").
create table tentativas_login (
  id bigint generated always as identity primary key,
  email text not null,
  ip text not null,
  em timestamptz not null default now()
);
create index tentativas_login_email_em on tentativas_login (email, em);
create index tentativas_login_ip_em on tentativas_login (ip, em);

alter table cameras add column criado_em timestamptz not null default now();
alter table botoes add column criado_em timestamptz not null default now();

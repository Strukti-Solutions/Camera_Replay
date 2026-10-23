-- Fase 1: um e-mail = uma conta em toda a plataforma (jogador, dono ou admin).
-- contas_email é a trava: a chave primária faz o banco recusar o e-mail repetido
-- entre as três tabelas de conta, e triggers a mantêm em dia.

create table contas_email (
  email text primary key check (email = lower(email)),
  tipo text not null check (tipo in ('jogador', 'dono', 'admin'))
);

create table jogadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(nome) between 1 and 80),
  email text not null unique check (email = lower(email)),
  senha_hash text not null,
  termos_versao text not null,
  termos_aceito_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);

create table sessoes_jogador (
  id uuid primary key default gen_random_uuid(),
  jogador_id uuid not null references jogadores (id) on delete cascade,
  token_hash text not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);
create index sessoes_jogador_expira on sessoes_jogador (expira_em);

-- Donos e admins que já existem.
insert into contas_email (email, tipo) select lower(email), 'dono' from usuarios;
insert into contas_email (email, tipo) select email, 'admin' from super_admins;

-- O tipo da conta vem do argumento do trigger (tg_argv[0]).
create function sincronizar_conta_email() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into contas_email (email, tipo) values (lower(new.email), tg_argv[0]);
    return new;
  elsif tg_op = 'DELETE' then
    delete from contas_email where email = lower(old.email) and tipo = tg_argv[0];
    return old;
  else
    if lower(new.email) is distinct from lower(old.email) then
      delete from contas_email where email = lower(old.email) and tipo = tg_argv[0];
      insert into contas_email (email, tipo) values (lower(new.email), tg_argv[0]);
    end if;
    return new;
  end if;
end;
$$;

create trigger usuarios_conta_email after insert or update of email or delete on usuarios
  for each row execute function sincronizar_conta_email('dono');
create trigger super_admins_conta_email after insert or update of email or delete on super_admins
  for each row execute function sincronizar_conta_email('admin');
create trigger jogadores_conta_email after insert or update of email or delete on jogadores
  for each row execute function sincronizar_conta_email('jogador');

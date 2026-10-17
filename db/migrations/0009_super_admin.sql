-- Plataforma: super admin com sessão própria e arena suspensa.
-- Super admin não pertence a nenhuma arena (sem arena_id): é a única conta que
-- cruza arenas, e só pelas funções de app/lib/plataforma.ts.

create table super_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  senha_hash text not null,
  criado_em timestamptz not null default now()
);

create table sessoes_admin (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references super_admins (id) on delete cascade,
  token_hash text not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);
create index sessoes_admin_expira on sessoes_admin (expira_em);

-- Estado da arena: só 'ativa' ou 'suspensa'. Valores antigos viram 'ativa'.
update arenas set status_assinatura = 'ativa' where status_assinatura not in ('ativa', 'suspensa');
alter table arenas add constraint arenas_status_assinatura_check
  check (status_assinatura in ('ativa', 'suspensa'));

-- registrar_aperto: arena suspensa não grava nada (nem visto_em), e a resposta é
-- vazia, igual à de token inválido. Resto idêntico ao da 0002.
create or replace function registrar_aperto(p_token_hash text)
returns table (clipe_id uuid, duplicado boolean)
language plpgsql as $$
declare
  v_botao botoes%rowtype;
  v_aperto_id uuid;
  v_recebido timestamptz;
  v_dias int;
  v_status text;
begin
  select * into v_botao from botoes
   where token_hash = p_token_hash and revogado_em is null
   for update;
  if not found then
    return;
  end if;

  select dias_retencao, status_assinatura into v_dias, v_status
    from arenas where id = v_botao.arena_id;
  if v_status is distinct from 'ativa' then
    return;
  end if;

  update botoes set visto_em = now() where id = v_botao.id;

  return query
    select c.id, true
      from apertos a
      join clipes c on c.aperto_id = a.id and c.arena_id = a.arena_id
     where a.botao_id = v_botao.id
       and a.arena_id = v_botao.arena_id
       and a.recebido_em > now() - interval '5 seconds'
     order by a.recebido_em desc
     limit 1;
  if found then
    return;
  end if;

  v_recebido := now();
  insert into apertos (arena_id, botao_id, recebido_em)
    values (v_botao.arena_id, v_botao.id, v_recebido)
    returning id into v_aperto_id;

  return query
    insert into clipes (arena_id, aperto_id, camera_id, status, recebido_em, expira_em)
    values (v_botao.arena_id, v_aperto_id, v_botao.camera_id, 'pendente',
            v_recebido, v_recebido + make_interval(days => v_dias))
    returning id, false;
end;
$$;

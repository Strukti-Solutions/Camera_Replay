-- Atenção: registrar_aperto conta com READ COMMITTED (o padrão do Postgres).
-- Em REPEATABLE READ/SERIALIZABLE o POST concorrente do mesmo botão recebe
-- erro de serialização em vez de duplicado=true.
-- Registra o aperto do botão. O FOR UPDATE no botão serializa POSTs
-- simultâneos do mesmo botão, então o dedupe de 5 s vale sob concorrência.
create or replace function registrar_aperto(p_token_hash text)
returns table (clipe_id uuid, duplicado boolean)
language plpgsql as $$
declare
  v_botao botoes%rowtype;
  v_aperto_id uuid;
  v_recebido timestamptz;
  v_dias int;
begin
  select * into v_botao from botoes
   where token_hash = p_token_hash and revogado_em is null
   for update;
  if not found then
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
  select dias_retencao into v_dias from arenas where id = v_botao.arena_id;

  return query
    insert into clipes (arena_id, aperto_id, camera_id, status, recebido_em, expira_em)
    values (v_botao.arena_id, v_aperto_id, v_botao.camera_id, 'pendente',
            v_recebido, v_recebido + make_interval(days => v_dias))
    returning id, false;
end;
$$;

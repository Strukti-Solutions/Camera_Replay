-- Registra o aperto do botão. O FOR UPDATE no botão serializa POSTs
-- simultâneos do mesmo botão, então o dedupe de 5 s vale sob concorrência.
-- Atenção: registrar_aperto conta com READ COMMITTED (o padrão do Postgres).
-- Em REPEATABLE READ/SERIALIZABLE o POST concorrente do mesmo botão recebe
-- erro de serialização em vez de duplicado=true.
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

-- Reserva clipes pendentes de uma câmera para o worker. SKIP LOCKED faz dois
-- workers (ou duas chamadas concorrentes) nunca pegarem o mesmo clipe.
-- O update casa também por arena_id, herdado da linha escolhida.
create or replace function pegar_clipes(p_camera_id uuid, p_limite int default 10)
returns table (clipe_id uuid, camera_id uuid, recebido_em timestamptz)
language sql as $$
  update clipes c
     set status = 'processando', iniciado_em = now()
    from (
      select id, arena_id from clipes
       where camera_id = p_camera_id and status = 'pendente'
       order by recebido_em
       limit p_limite
       for update skip locked
    ) s
   where c.id = s.id and c.arena_id = s.arena_id
  returning c.id, c.camera_id, c.recebido_em;
$$;

-- Só age sobre 'processando': um clipe que o reaper já marcou 'falhou' não ressuscita.
create or replace function marcar_pronto(
  p_clipe_id uuid, p_chave text, p_tamanho bigint, p_duracao real, p_parcial boolean)
returns boolean
language plpgsql as $$
declare
  v_n int;
begin
  update clipes
     set status = case when p_parcial then 'parcial' else 'pronto' end,
         chave_r2 = p_chave, tamanho = p_tamanho, duracao = p_duracao
   where id = p_clipe_id and status = 'processando';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function marcar_falhou(p_clipe_id uuid, p_motivo text)
returns boolean
language plpgsql as $$
declare
  v_n int;
begin
  update clipes set status = 'falhou', motivo = p_motivo
   where id = p_clipe_id and status = 'processando';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Reaper: pendente ou processando há mais de 2 min desde recebido_em vira falhou.
create or replace function expirar_presos()
returns integer
language plpgsql as $$
declare
  v_n int;
begin
  update clipes set status = 'falhou', motivo = 'tempo esgotado'
   where status in ('pendente', 'processando')
     and recebido_em < now() - interval '2 minutes';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

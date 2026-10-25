-- Worker não conecta em câmera de arena suspensa (dívida do multi-arena).
-- Mesma assinatura e retorno: create or replace mantém dono e permissões da função.
create or replace function listar_cameras()
returns table (camera_id uuid, arena_id uuid, sn text, credenciais text)
language sql stable as $$
  select c.id, c.arena_id, c.sn, c.credenciais
  from cameras c
  join arenas a on a.id = c.arena_id and a.status_assinatura = 'ativa'
  where exists (
    select 1 from botoes b
    where b.camera_id = c.id and b.arena_id = c.arena_id and b.revogado_em is null
  )
  order by c.id;
$$;

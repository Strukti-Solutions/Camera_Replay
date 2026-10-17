-- Funções do worker de captura: quais câmeras abrir e o status de cada uma.

-- Só câmeras com pelo menos um botão ativo (não revogado). No fluxo manual de
-- troca de câmera o botão é religado à nova, então a antiga sai da lista e o
-- mesmo sn não abre duas conexões.
create function listar_cameras()
returns table (camera_id uuid, arena_id uuid, sn text, credenciais text)
language sql stable as $$
  select c.id, c.arena_id, c.sn, c.credenciais
  from cameras c
  where exists (
    select 1 from botoes b
    where b.camera_id = c.id and b.arena_id = c.arena_id and b.revogado_em is null
  )
  order by c.id;
$$;

-- Grava o status da câmera; 'online' também atualiza visto_em. Devolve false se
-- a câmera não existe. Status fora de online/offline cai no check da tabela.
create function marcar_camera(p_camera_id uuid, p_status text)
returns boolean
language plpgsql as $$
begin
  update cameras
     set status = p_status,
         visto_em = case when p_status = 'online' then now() else visto_em end
   where id = p_camera_id;
  return found;
end;
$$;

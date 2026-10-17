-- Câmera presa à quadra (piloto: uma câmera e um botão por quadra).
-- quadra_id e arena_id não mudam depois de criada a câmera. Mover câmera é
-- reconfiguração manual: câmera nova na quadra certa e religar o botão.
-- Erro: SQLSTATE 23514 (check_violation). Nome, status, visto_em e credenciais
-- seguem editáveis.
create function cameras_fixas() returns trigger
language plpgsql as $$
begin
  if new.quadra_id is distinct from old.quadra_id then
    raise exception 'cameras.quadra_id não pode mudar' using errcode = '23514';
  end if;
  if new.arena_id is distinct from old.arena_id then
    raise exception 'cameras.arena_id não pode mudar' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger cameras_fixas before update on cameras
  for each row execute function cameras_fixas();

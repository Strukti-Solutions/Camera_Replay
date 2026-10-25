-- Fase 3 do visual novo: fotos da arena (quadra_id nulo) e de cada quadra, no R2.
-- A capa é a de menor posição. A ordem é renumerada de 0 a n-1 pelo app.
create table fotos (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas(id),
  quadra_id uuid,
  chave text not null unique,
  tipo text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp')),
  bytes int not null check (bytes between 1 and 2097152),
  posicao smallint not null check (posicao >= 0),
  criado_em timestamptz not null default now(),
  foreign key (quadra_id, arena_id) references quadras (id, arena_id) on delete cascade
);

create index fotos_arena_quadra_posicao on fotos (arena_id, quadra_id, posicao);

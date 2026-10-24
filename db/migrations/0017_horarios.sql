-- Fase 2 do visual novo: horários do dono, em minutos, com preço próprio.
-- Substitui as faixas de hora cheia de precos_quadra (que fica até a troca das telas).
create table horarios_quadra (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null,
  quadra_id uuid not null,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  inicio smallint not null check (inicio between 0 and 1439),
  fim smallint not null check (fim between 1 and 1440),
  preco_centavos int not null check (preco_centavos between 1 and 1000000),
  criado_em timestamptz not null default now(),
  check (fim - inicio between 15 and 720),
  foreign key (quadra_id, arena_id) references quadras (id, arena_id) on delete cascade,
  exclude using gist (quadra_id with =, dia_semana with =, int4range(inicio, fim) with &&)
);

create index horarios_quadra_quadra_dia on horarios_quadra (quadra_id, dia_semana);

-- Cada faixa antiga vira horários de 1 hora com o mesmo preço.
insert into horarios_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos)
select p.arena_id, p.quadra_id, p.dia_semana, h * 60, h * 60 + 60, p.preco_centavos
  from precos_quadra p, generate_series(p.inicio, p.fim - 1) as h;

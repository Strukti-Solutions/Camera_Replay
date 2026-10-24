-- Fase 4a: reservas de quadra e bloqueios do dono, na mesma tabela e na mesma
-- regra de não sobreposição (a antiga tabela reservas saiu na 0010).
create extension if not exists btree_gist;

create table reservas (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas (id),
  quadra_id uuid not null,
  jogador_id uuid references jogadores (id) on delete set null,
  tipo text not null check (tipo in ('reserva', 'bloqueio')),
  situacao text not null check (situacao in ('segurada', 'confirmada', 'cancelada', 'expirada')),
  inicio timestamptz not null,
  fim timestamptz not null,
  periodo tstzrange generated always as (tstzrange(inicio, fim, '[)')) stored,
  segura_ate timestamptz,
  pagamento text check (pagamento in ('arena', 'online')),
  total_centavos int check (total_centavos >= 0),
  taxa_centavos int check (taxa_centavos >= 0),
  detalhe jsonb,
  motivo text,
  cancelada_em timestamptz,
  cancelada_por text check (cancelada_por in ('jogador', 'dono')),
  motivo_cancelamento text,
  criado_em timestamptz not null default now(),
  unique (id, arena_id),
  foreign key (quadra_id, arena_id) references quadras (id, arena_id),
  check (fim > inicio and fim - inicio <= interval '12 hours'),
  check (
    (tipo = 'reserva' and total_centavos is not null and detalhe is not null)
    or (tipo = 'bloqueio' and motivo is not null and jogador_id is null)
  ),
  exclude using gist (quadra_id with =, periodo with &&)
    where (situacao in ('segurada', 'confirmada'))
);

create index reservas_arena_inicio on reservas (arena_id, inicio);
create index reservas_jogador_inicio on reservas (jogador_id, inicio);

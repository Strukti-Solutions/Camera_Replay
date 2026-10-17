-- Schema inicial. Toda tabela filha carrega arena_id e tem unique (id, arena_id)
-- para servir de alvo às FKs compostas (isolamento entre arenas).

create table arenas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  plano text not null default 'piloto',
  status_assinatura text not null default 'ativa',
  dias_retencao int not null default 7 check (dias_retencao > 0),
  criado_em timestamptz not null default now()
);

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas(id),
  email text not null unique,
  senha_hash text not null,
  papel text not null check (papel in ('dono', 'equipe')),
  unique (id, arena_id)
);

create table quadras (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas(id),
  nome text not null,
  slug text not null unique check (length(slug) >= 20),
  unique (id, arena_id)
);

create table cameras (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas(id),
  quadra_id uuid not null,
  nome text not null,
  sn text not null,
  credenciais text not null,
  status text not null default 'offline' check (status in ('online', 'offline')),
  visto_em timestamptz,
  unique (id, arena_id),
  unique (quadra_id, id),
  foreign key (quadra_id, arena_id) references quadras (id, arena_id)
);

create table botoes (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas(id),
  quadra_id uuid not null,
  camera_id uuid not null,
  token_hash text not null unique,
  visto_em timestamptz,
  revogado_em timestamptz,
  unique (id, arena_id),
  foreign key (quadra_id, arena_id) references quadras (id, arena_id),
  foreign key (quadra_id, camera_id) references cameras (quadra_id, id)
);

create table apertos (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas(id),
  botao_id uuid not null,
  recebido_em timestamptz not null default now(),
  status text not null default 'aceito',
  unique (id, arena_id),
  foreign key (botao_id, arena_id) references botoes (id, arena_id)
);
create index apertos_botao_recebido_idx on apertos (botao_id, recebido_em desc);

create table clipes (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas(id),
  aperto_id uuid not null unique,
  camera_id uuid not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'pronto', 'parcial', 'falhou')),
  chave_r2 text,
  duracao real,
  tamanho bigint,
  motivo text,
  recebido_em timestamptz not null,  -- cópia do aperto, evita join na fila e na página
  iniciado_em timestamptz,
  expira_em timestamptz not null,
  unique (id, arena_id),
  foreign key (aperto_id, arena_id) references apertos (id, arena_id),
  foreign key (camera_id, arena_id) references cameras (id, arena_id)
);
create index clipes_fila_idx on clipes (camera_id, recebido_em) where status = 'pendente';
create index clipes_expira_idx on clipes (expira_em);

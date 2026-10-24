-- Fase 2 (Strukti cria, dono ajusta): endereço e coordenadas da arena (para o
-- mapa e a busca por proximidade), taxa da Strukti por arena e tabela de preços.
alter table arenas
  add column endereco_rua text,
  add column endereco_numero text,
  add column endereco_bairro text,
  add column endereco_cidade text,
  add column endereco_uf text,
  add column endereco_cep text,
  add column latitude double precision,
  add column longitude double precision,
  -- Taxa padrão de 5%; o teto de 30% evita erro de digitação cobrar demais.
  add column taxa_percentual numeric(5,2) not null default 5
    check (taxa_percentual between 0 and 30);

-- Esporte da quadra em texto livre; vazio significa "não informado".
alter table quadras
  add column esporte text not null default '' check (length(esporte) <= 40);

-- Faixas de preço por quadra, dia da semana (0 = domingo) e hora cheia.
-- A chave composta impede preço de uma quadra gravado em outra arena.
create table precos_quadra (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null,
  quadra_id uuid not null,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  inicio smallint not null check (inicio between 0 and 23),
  fim smallint not null check (fim between 1 and 24),
  preco_centavos int not null check (preco_centavos between 1 and 1000000),
  criado_em timestamptz not null default now(),
  check (fim > inicio),
  foreign key (quadra_id, arena_id) references quadras (id, arena_id) on delete cascade
);

create index precos_quadra_quadra_dia on precos_quadra (quadra_id, dia_semana);

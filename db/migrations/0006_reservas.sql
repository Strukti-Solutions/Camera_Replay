-- Alunos e reservas de quadra. Toda tabela carrega arena_id e as FKs são
-- compostas (..., arena_id): aluno, reserva, clipe e quadra de arenas
-- diferentes nunca se ligam.

-- Aluno cadastrado pelo dono. O e-mail é guardado normalizado (minúsculas)
-- e é único só dentro da arena: outra arena com o mesmo e-mail é outra conta.
create table alunos (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas(id),
  nome text not null check (length(nome) between 1 and 80),
  email text not null check (email = lower(email)),
  senha_hash text not null,
  criado_em timestamptz not null default now(),
  unique (arena_id, email),
  unique (id, arena_id)
);

-- Reserva de uma quadra. A sobreposição é checada pela aplicação (sem btree_gist).
create table reservas (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references arenas(id),
  quadra_id uuid not null,
  inicio timestamptz not null,
  fim timestamptz not null,
  criado_em timestamptz not null default now(),
  check (fim > inicio and fim - inicio <= interval '12 hours'),
  unique (id, arena_id),
  foreign key (quadra_id, arena_id) references quadras (id, arena_id)
);
create index reservas_quadra_inicio_idx on reservas (arena_id, quadra_id, inicio);

create table reserva_alunos (
  reserva_id uuid not null,
  aluno_id uuid not null,
  arena_id uuid not null references arenas(id),
  primary key (reserva_id, aluno_id),
  foreign key (reserva_id, arena_id) references reservas (id, arena_id) on delete cascade,
  foreign key (aluno_id, arena_id) references alunos (id, arena_id) on delete cascade
);
create index reserva_alunos_aluno_idx on reserva_alunos (aluno_id);

-- Atribuição explícita de um lance a um aluno (fora de qualquer reserva).
create table clipe_alunos (
  clipe_id uuid not null,
  aluno_id uuid not null,
  arena_id uuid not null references arenas(id),
  primary key (clipe_id, aluno_id),
  foreign key (clipe_id, arena_id) references clipes (id, arena_id) on delete cascade,
  foreign key (aluno_id, arena_id) references alunos (id, arena_id) on delete cascade
);
create index clipe_alunos_aluno_idx on clipe_alunos (aluno_id);

-- Sessão do aluno, no molde de sessoes. Só o hash do token vai para o banco.
create table sessoes_aluno (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null,
  aluno_id uuid not null,
  token_hash text not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  foreign key (aluno_id, arena_id) references alunos (id, arena_id) on delete cascade
);

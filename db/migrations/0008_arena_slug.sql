-- Slug público da arena: um único QR por arena abre a área do aluno.
-- Arenas existentes ganham 32 hex; as novas, 22 caracteres de novoSlug().
-- Aleatório (UUID v4 sem hífens, 32 caracteres, só [0-9a-f]), como o das quadras.
-- O default cobre inserts que não informam o slug; o app gera o seu com novoSlug().

alter table arenas add column slug text;

-- Arenas existentes recebem um valor próprio (a função é avaliada por linha).
update arenas set slug = replace(gen_random_uuid()::text, '-', '');

alter table arenas alter column slug set default replace(gen_random_uuid()::text, '-', '');
alter table arenas alter column slug set not null;
alter table arenas add constraint arenas_slug_key unique (slug);
alter table arenas add constraint arenas_slug_check check (slug ~ '^[A-Za-z0-9_-]{20,64}$');

-- Conta criada pelo próprio aluno no QR (sem verificação de e-mail): o dono vê a marca
-- e confere a pessoa antes de pô-la numa reserva (mitiga conta criada com e-mail alheio).
alter table alunos add column criado_pelo_aluno boolean not null default false;

-- Slug público da arena: um único QR por arena abre a área do aluno.
-- Aleatório (UUID v4 sem hífens, 32 caracteres, só [0-9a-f]), como o das quadras.
-- O default cobre inserts que não informam o slug; o app gera o seu com novoSlug().

alter table arenas add column slug text;

-- Arenas existentes recebem um valor próprio (a função é avaliada por linha).
update arenas set slug = replace(gen_random_uuid()::text, '-', '');

alter table arenas alter column slug set default replace(gen_random_uuid()::text, '-', '');
alter table arenas alter column slug set not null;
alter table arenas add constraint arenas_slug_key unique (slug);
alter table arenas add constraint arenas_slug_check check (length(slug) >= 20);

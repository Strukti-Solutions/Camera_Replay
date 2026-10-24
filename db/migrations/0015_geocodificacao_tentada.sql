-- Última tentativa de geocodificar o endereço da arena (limite do Nominatim: 1 req/s, IP compartilhado).
alter table arenas add column geocodificacao_tentada_em timestamptz;

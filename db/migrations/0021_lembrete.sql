-- Lembrete da véspera por e-mail: cada reserva recebe no máximo um. Quem marca
-- a coluna (de nulo para o instante) é quem envia; falha no envio volta a nulo.
alter table reservas add column lembrete_enviado_em timestamptz;

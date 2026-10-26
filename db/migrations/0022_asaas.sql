-- Fase 4b: pagamento online pelo Asaas (spec 2026-10-26-pagamento-asaas-design.md).
-- Arena com carteira cobra online; sem carteira continua no "pagar na arena".
alter table arenas add column asaas_wallet_id uuid;

-- Dados do Checkout e da cobrança, e a situação do estorno de uma reserva paga.
alter table reservas
  add column asaas_checkout_id text,
  add column asaas_checkout_link text,
  add column asaas_pagamento_id text,
  add column pago_centavos int check (pago_centavos >= 0),
  add column liquido_centavos int check (liquido_centavos >= 0),
  add column pago_em timestamptz,
  add column estorno text check (estorno in ('solicitado', 'concluido', 'pendente')),
  add column estorno_centavos int check (estorno_centavos >= 0);

create unique index reservas_asaas_checkout on reservas (asaas_checkout_id) where asaas_checkout_id is not null;
create index reservas_estorno_pendente on reservas (estorno) where estorno = 'pendente';

-- Cada evento do webhook uma vez só (o id do Asaas é a chave), para idempotência e auditoria.
create table asaas_eventos (
  id text primary key,
  tipo text not null,
  payload jsonb not null,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  erro text
);

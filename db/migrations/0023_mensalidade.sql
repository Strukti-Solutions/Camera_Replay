-- Mensalidade do dono por assinatura no Asaas (spec 2026-10-26-mensalidade-design.md).
-- Opcional por arena: sem valor, sem mensalidade.
alter table arenas
  add column mensalidade_centavos int check (mensalidade_centavos > 0),
  add column mensalidade_dia smallint check (mensalidade_dia between 1 and 28),
  add column dono_documento text check (dono_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  add column dono_nome_cobranca text check (length(dono_nome_cobranca) between 1 and 100),
  add column asaas_cliente_id text,
  add column asaas_assinatura_id text unique;

-- Uma linha por cobrança da assinatura (o id é o da cobrança no Asaas).
create table mensalidades (
  id text primary key,
  arena_id uuid not null references arenas (id) on delete cascade,
  valor_centavos int not null check (valor_centavos >= 0),
  vencimento date not null,
  situacao text not null check (situacao in ('pendente', 'atrasada', 'paga', 'estornada', 'cancelada')),
  link text,
  pago_em timestamptz,
  atualizado_em timestamptz not null default now()
);

create index mensalidades_arena on mensalidades (arena_id, vencimento desc);

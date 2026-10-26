import type { Db } from "./db";
import { criarArenaComDono } from "./donos";
import { hashSenha, SENHA_MIN_ADMIN } from "./senha";

// Funções de administração da plataforma: cruzam arenas. Só app/admin/** (e os CLIs
// de db/) importam este módulo, e as páginas e actions de /admin chamam depois de
// exigirSuperAdmin() (tests/isolamento-plataforma.test.ts confere).
// A lista pública de arenas (só nome e slug) mora em arenas-publicas.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StatusArena = "ativa" | "suspensa";

export type ArenaAdmin = {
  id: string; nome: string; slug: string; status: StatusArena;
  quadras: number; donoEmail: string | null; criadoEm: Date; taxaPercentual: number;
  mensalidadeCentavos: number | null; // null = sem mensalidade
  situacaoMensalidade: string | null; // "atrasada" se houver alguma; senão a da cobrança mais recente
};

// Situação da mensalidade para a lista: atrasada pesa mais que a cobrança mais nova.
const SQL_SITUACAO_MENSALIDADE = `coalesce(
  (select 'atrasada' from mensalidades m where m.arena_id = a.id and m.situacao = 'atrasada' limit 1),
  (select m.situacao from mensalidades m where m.arena_id = a.id and m.situacao <> 'cancelada'
    order by m.vencimento desc, m.id limit 1))`;

// Todas as arenas, para o painel do super admin. Nunca devolve senha_hash.
export async function listarArenasAdmin(db: Db): Promise<ArenaAdmin[]> {
  const { rows } = await db.query<{
    id: string; nome: string; slug: string; status: StatusArena; quadras: number;
    dono_email: string | null; criado_em: Date; taxa: string | number; mensalidade: number | null; situacao: string | null;
  }>(
    `select a.id, a.nome, a.slug, a.status_assinatura as status, a.criado_em, a.taxa_percentual as taxa,
            a.mensalidade_centavos as mensalidade, ${SQL_SITUACAO_MENSALIDADE} as situacao,
            (select count(*) from quadras q where q.arena_id = a.id)::int as quadras,
            (select min(u.email) from usuarios u where u.arena_id = a.id and u.papel = 'dono') as dono_email
       from arenas a
      order by a.criado_em desc, a.id`,
  );
  return rows.map((r) => ({
    id: r.id, nome: r.nome, slug: r.slug, status: r.status,
    quadras: Number(r.quadras), donoEmail: r.dono_email, criadoEm: r.criado_em,
    taxaPercentual: Number(r.taxa),
    mensalidadeCentavos: r.mensalidade === null ? null : Number(r.mensalidade), situacaoMensalidade: r.situacao,
  }));
}

// Arena e dono num comando só (criarArenaComDono): e-mail já usado lança
// "e-mail já cadastrado" e nada fica pela metade.
export async function criarArenaAdmin(
  db: Db,
  dados: { arena: string; email: string; senha: string },
): Promise<{ arenaId: string; usuarioId: string }> {
  return criarArenaComDono(db, dados);
}

// true se a arena existe (e agora está no estado pedido); id malformado ou status
// inválido não tocam o banco. Suspender apaga as sessões de dono da arena
// (reativar não revive sessão antiga); o resto fica e volta ao reativar.
export async function definirStatusArena(db: Db, arenaId: string, status: StatusArena): Promise<boolean> {
  if (typeof arenaId !== "string" || !UUID.test(arenaId)) return false;
  if (status !== "ativa" && status !== "suspensa") return false;
  const r = await db.query("update arenas set status_assinatura = $2 where id = $1 returning id", [arenaId, status]);
  if (r.rows.length === 0) return false;
  if (status === "suspensa") {
    await db.query("delete from sessoes where arena_id = $1", [arenaId]);
  }
  return true;
}

export async function criarSuperAdmin(db: Db, dados: { email: string; senha: string }): Promise<{ id: string }> {
  if (typeof dados.senha !== "string" || dados.senha.length < SENHA_MIN_ADMIN) {
    throw new Error(`senha curta: mínimo ${SENHA_MIN_ADMIN} caracteres`);
  }
  const email = String(dados.email ?? "").trim().toLowerCase();
  if (!email.includes("@") || email.length > 200) throw new Error("e-mail inválido");
  const hash = await hashSenha(dados.senha);
  try {
    const r = await db.query<{ id: string }>(
      "insert into super_admins (email, senha_hash) values ($1, $2) returning id",
      [email, hash],
    );
    return { id: r.rows[0].id };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new Error("e-mail já cadastrado");
    throw e;
  }
}

export type DetalheArenaAdmin = {
  id: string; nome: string; slug: string; status: StatusArena;
  taxaPercentual: number; donoEmail: string | null;
  carteiraAsaas: string | null; // walletId do dono no Asaas; null = "pagar na arena"
  mensalidade: { valorCentavos: number | null; dia: number | null; documento: string | null; nome: string | null };
};

// Uma arena para a página de configuração. Id malformado vale como inexistente
// e não chega ao banco. Nunca devolve senha_hash.
export async function detalheArenaAdmin(db: Db, arenaId: string): Promise<DetalheArenaAdmin | null> {
  if (typeof arenaId !== "string" || !UUID.test(arenaId)) return null;
  const { rows } = await db.query<{
    id: string; nome: string; slug: string; status: StatusArena; taxa: string | number; dono_email: string | null;
    carteira: string | null; mensalidade: number | null; dia: number | null; documento: string | null; nome_cobranca: string | null;
  }>(
    `select a.id, a.nome, a.slug, a.status_assinatura as status, a.taxa_percentual as taxa, a.asaas_wallet_id as carteira,
            a.mensalidade_centavos as mensalidade, a.mensalidade_dia as dia, a.dono_documento as documento,
            a.dono_nome_cobranca as nome_cobranca,
            (select min(u.email) from usuarios u where u.arena_id = a.id and u.papel = 'dono') as dono_email
       from arenas a where a.id = $1`,
    [arenaId],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, nome: r.nome, slug: r.slug, status: r.status, taxaPercentual: Number(r.taxa), donoEmail: r.dono_email,
    carteiraAsaas: r.carteira,
    mensalidade: {
      valorCentavos: r.mensalidade === null ? null : Number(r.mensalidade), dia: r.dia === null ? null : Number(r.dia),
      documento: r.documento, nome: r.nome_cobranca,
    } };
}

// Carteira Asaas do dono (walletId, um uuid) para o split das reservas online.
// Em branco desvincula: a arena volta ao "pagar na arena". Formato inválido ou
// arena inexistente devolvem false sem gravar.
export async function definirCarteiraAsaas(db: Db, arenaId: string, carteira: string): Promise<boolean> {
  if (typeof arenaId !== "string" || !UUID.test(arenaId) || typeof carteira !== "string") return false;
  const valor = carteira.trim().toLowerCase();
  if (valor !== "" && !UUID.test(valor)) return false;
  const r = await db.query("update arenas set asaas_wallet_id = $2 where id = $1 returning id", [arenaId, valor || null]);
  return r.rows.length === 1;
}

export const TAXA_MAX = 30;

// Taxa da Strukti sobre as reservas da arena: 0 a 30, no máximo 2 casas decimais.
// Fora disso devolve false sem gravar; true se a arena existe e foi atualizada.
export async function definirTaxaArena(db: Db, arenaId: string, percentual: number): Promise<boolean> {
  if (typeof arenaId !== "string" || !UUID.test(arenaId)) return false;
  if (typeof percentual !== "number" || !Number.isFinite(percentual)) return false;
  if (percentual < 0 || percentual > TAXA_MAX) return false;
  const centesimos = percentual * 100;
  if (Math.abs(centesimos - Math.round(centesimos)) > 1e-9) return false;
  const r = await db.query("update arenas set taxa_percentual = $2 where id = $1 returning id", [
    arenaId,
    Math.round(centesimos) / 100,
  ]);
  return r.rows.length === 1;
}

// ---------- Pagamentos (Asaas) ----------

export type PendenciasPagamento = {
  estornos: {
    reservaId: string; arena: string; jogador: string; pagamentoId: string; pagoCentavos: number;
    inicio: Date; canceladaPor: string | null;
  }[];
  eventos: { id: string; tipo: string; erro: string; recebidoEm: Date }[];
  mensalidades: { arenaId: string; arena: string; valorCentavos: number; vencimento: string; link: string | null }[];
};

// O que a Strukti precisa resolver à mão: estornos que o Asaas recusou (ex.:
// dono sem saldo), eventos do webhook que não foram processados e mensalidades
// atrasadas (a Strukti decide se suspende a arena).
export async function pendenciasDePagamento(db: Db): Promise<PendenciasPagamento> {
  const [e, v, m] = await Promise.all([
    db.query<{
      id: string; arena: string; jogador: string | null; pagamento: string; pago: number; inicio: Date; por: string | null;
    }>(
      `select r.id, a.nome as arena, j.nome as jogador, r.asaas_pagamento_id as pagamento, r.pago_centavos as pago,
              r.inicio, r.cancelada_por as por
         from reservas r join arenas a on a.id = r.arena_id left join jogadores j on j.id = r.jogador_id
        where r.estorno = 'pendente'
           -- Cancelada e paga, mas o pedido de estorno não chegou a sair (a função caiu no meio).
           or (r.situacao = 'cancelada' and r.asaas_pagamento_id is not null and r.estorno is null
               and r.cancelada_em < now() - interval '5 minutes')
        order by r.cancelada_em, r.id
        limit 100`,
    ),
    db.query<{ id: string; tipo: string; erro: string; recebido_em: Date }>(
      `select id, tipo, coalesce(erro, 'não processado') as erro, recebido_em from asaas_eventos
        where erro is not null or (processado_em is null and recebido_em < now() - interval '5 minutes')
        order by recebido_em desc limit 50`,
    ),
    db.query<{ arena_id: string; arena: string; valor: number; vencimento: string; link: string | null }>(
      `select m.arena_id, a.nome as arena, m.valor_centavos as valor, to_char(m.vencimento, 'YYYY-MM-DD') as vencimento, m.link
         from mensalidades m join arenas a on a.id = m.arena_id
        where m.situacao = 'atrasada'
        order by m.vencimento, m.id limit 100`,
    ),
  ]);
  return {
    estornos: e.rows.map((r) => ({
      reservaId: r.id, arena: r.arena, jogador: r.jogador ?? "Conta apagada", pagamentoId: r.pagamento,
      pagoCentavos: Number(r.pago ?? 0), inicio: new Date(r.inicio), canceladaPor: r.por,
    })),
    eventos: v.rows.map((r) => ({ id: r.id, tipo: r.tipo, erro: r.erro, recebidoEm: new Date(r.recebido_em) })),
    mensalidades: m.rows.map((r) => ({
      arenaId: r.arena_id, arena: r.arena, valorCentavos: Number(r.valor), vencimento: r.vencimento, link: r.link,
    })),
  };
}

// A Strukti resolveu o estorno fora do sistema (no painel do Asaas ou com o dono).
// Antes, conferir no Asaas: um estorno "pendente" pode ter saído e só a
// gravação local ter falhado.
export async function marcarEstornoResolvido(db: Db, reservaId: string): Promise<boolean> {
  if (typeof reservaId !== "string" || !UUID.test(reservaId)) return false;
  const r = await db.query(
    `update reservas set estorno = 'concluido'
      where id = $1 and situacao = 'cancelada' and asaas_pagamento_id is not null
        and (estorno = 'pendente' or estorno is null)
      returning id`,
    [reservaId],
  );
  return r.rows.length === 1;
}

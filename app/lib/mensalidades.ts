// Mensalidade do dono: assinatura mensal no Asaas, na conta da Strukti, com o
// dono como cliente. Opcional por arena. Spec:
// docs/superpowers/specs/2026-10-26-mensalidade-design.md.
import { ErroAsaas, type Asaas, type PagamentoAsaas } from "./asaas";
import type { Db } from "./db";
import { hojeLocal } from "./disponibilidade";
import { centavosDeTexto } from "./precos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CPF (11) ou CNPJ (14) só com dígitos, conferido pelos dígitos verificadores.
export function documentoValido(bruto: string): string | null {
  const d = String(bruto ?? "").replace(/[.\-/\s]/g, "");
  if (!/^(\d{11}|\d{14})$/.test(d) || /^(\d)\1+$/.test(d)) return null;
  const n = d.split("").map(Number);
  const dv = (base: number[], pesos: number[]) => {
    const r = base.reduce((s, x, i) => s + x * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (d.length === 11) {
    const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return dv(n.slice(0, 9), p1) === n[9] && dv(n.slice(0, 10), p2) === n[10] ? d : null;
  }
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  return dv(n.slice(0, 12), p1) === n[12] && dv(n.slice(0, 13), p2) === n[13] ? d : null;
}

// Próxima data (AAAA-MM-DD) com o dia escolhido, depois de hoje no fuso da arena.
export function proximoVencimento(dia: number, agora: Date): string {
  const [a, m, d] = hojeLocal(agora).split("-").map(Number);
  const [ano, mes] = d < dia ? [a, m] : m === 12 ? [a + 1, 1] : [a, m + 1];
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export type EntradaMensalidade = { valor: string; dia: string; documento: string; nome: string };
export type ResultadoMensalidade = { ok: true } | { ok: false; erro: string };

const erroDoAsaas = (e: unknown) =>
  e instanceof ErroAsaas ? `O Asaas recusou (${e.codigo ?? `HTTP ${e.status}`}).` : "Não foi possível falar com o Asaas. Tente de novo.";

// Salva a mensalidade da arena: valor em branco tira a mensalidade. Chama o
// Asaas primeiro e só grava no banco depois; se o banco falhar logo depois de
// criar a assinatura, ela é excluída para não cobrar sem registro.
export async function definirMensalidade(
  db: Pick<Db, "query">, asaas: Asaas | null, arenaId: string, e: EntradaMensalidade, agora: Date,
): Promise<ResultadoMensalidade> {
  if (typeof arenaId !== "string" || !UUID.test(arenaId)) return { ok: false, erro: "Arena não encontrada." };
  const { rows } = await db.query<{
    nome: string; email: string | null; valor: number | null; dia: number | null; documento: string | null;
    cliente: string | null; assinatura: string | null;
  }>(
    `select a.nome, (select min(u.email) from usuarios u where u.arena_id = a.id and u.papel = 'dono') as email,
            a.mensalidade_centavos as valor, a.mensalidade_dia as dia, a.dono_documento as documento,
            a.asaas_cliente_id as cliente, a.asaas_assinatura_id as assinatura
       from arenas a where a.id = $1`,
    [arenaId],
  );
  const a = rows[0];
  if (!a) return { ok: false, erro: "Arena não encontrada." };

  // Sem mensalidade.
  if (!String(e.valor ?? "").trim()) {
    if (a.assinatura) {
      if (!asaas) return { ok: false, erro: "Pagamento online não configurado (ASAAS_API_KEY)." };
      try {
        await asaas.excluirAssinatura(a.assinatura);
      } catch (err) {
        return { ok: false, erro: erroDoAsaas(err) };
      }
    }
    await db.query(
      "update arenas set mensalidade_centavos = null, mensalidade_dia = null, asaas_assinatura_id = null where id = $1",
      [arenaId],
    );
    await db.query(
      "update mensalidades set situacao = 'cancelada', atualizado_em = $2 where arena_id = $1 and situacao in ('pendente', 'atrasada')",
      [arenaId, agora],
    );
    return { ok: true };
  }

  const valor = centavosDeTexto(String(e.valor));
  if (valor === null) return { ok: false, erro: "Valor inválido: use reais, por exemplo 149,90." };
  const diaTexto = String(e.dia ?? "").trim();
  const dia = /^\d{1,2}$/.test(diaTexto) ? Number(diaTexto) : 0;
  if (dia < 1 || dia > 28) return { ok: false, erro: "Dia do vencimento: de 1 a 28." };
  const documento = documentoValido(e.documento);
  if (!documento) return { ok: false, erro: "CPF ou CNPJ do dono inválido." };
  const nome = String(e.nome ?? "").trim();
  if (nome.length < 1 || nome.length > 100) return { ok: false, erro: "Informe o nome que vai na cobrança (até 100 caracteres)." };
  if (!asaas) return { ok: false, erro: "Pagamento online não configurado (ASAAS_API_KEY)." };
  if (!a.email) return { ok: false, erro: "A arena não tem e-mail de dono para receber a cobrança." };

  if (a.assinatura) {
    if (a.documento !== documento) {
      return { ok: false, erro: "Para trocar o CPF ou CNPJ, apague a mensalidade (valor em branco) e cadastre de novo." };
    }
    if (a.valor !== valor || a.dia !== dia) {
      try {
        await asaas.alterarAssinatura(a.assinatura, { valorCentavos: valor, vencimento: proximoVencimento(dia, agora) });
      } catch (err) {
        return { ok: false, erro: erroDoAsaas(err) };
      }
    }
    await db.query(
      "update arenas set mensalidade_centavos = $2, mensalidade_dia = $3, dono_nome_cobranca = $4 where id = $1",
      [arenaId, valor, dia, nome],
    );
    return { ok: true };
  }

  let cliente: string;
  let assinatura: string;
  try {
    cliente = a.cliente && a.documento === documento
      ? a.cliente
      : await asaas.criarCliente({ nome, documento, email: a.email, arenaId });
    assinatura = await asaas.criarAssinatura({
      cliente, valorCentavos: valor, vencimento: proximoVencimento(dia, agora), descricao: `Mensalidade Replay · ${a.nome}`, arenaId,
    });
  } catch (err) {
    return { ok: false, erro: erroDoAsaas(err) };
  }
  try {
    await db.query(
      `update arenas set mensalidade_centavos = $2, mensalidade_dia = $3, dono_documento = $4, dono_nome_cobranca = $5,
              asaas_cliente_id = $6, asaas_assinatura_id = $7
        where id = $1`,
      [arenaId, valor, dia, documento, nome, cliente, assinatura],
    );
  } catch (err) {
    console.error("mensalidade: assinatura criada mas não gravada; excluindo:", err instanceof Error ? err.message : "erro");
    await asaas.excluirAssinatura(assinatura).catch(() => console.error("mensalidade: assinatura órfã no Asaas, excluir à mão"));
    return { ok: false, erro: "Não foi possível salvar. Tente de novo." };
  }
  return { ok: true };
}

function situacaoDoStatus(status: string): "pendente" | "atrasada" | "paga" | "estornada" {
  if (status === "OVERDUE") return "atrasada";
  if (status === "CONFIRMED" || status === "RECEIVED" || status === "RECEIVED_IN_CASH") return "paga";
  if (status === "REFUNDED") return "estornada";
  return "pendente";
}

// Cobrança da assinatura, já lida da API (nunca do payload do webhook). A arena
// sai da assinatura ou de uma linha já gravada. false = não é de nenhuma arena.
export async function processarCobrancaMensalidade(
  db: Pick<Db, "query">, p: PagamentoAsaas, agora: Date,
): Promise<boolean> {
  const { rows } = await db.query<{ arena_id: string }>(
    `select id as arena_id from arenas where $1::text is not null and asaas_assinatura_id = $1
     union all
     select arena_id from mensalidades where id = $2
     limit 1`,
    [p.assinatura, p.id],
  );
  const arenaId = rows[0]?.arena_id;
  if (!arenaId || !p.vencimento) return false;
  const situacao = situacaoDoStatus(p.status);
  await db.query(
    `insert into mensalidades (id, arena_id, valor_centavos, vencimento, situacao, link, pago_em, atualizado_em)
     values ($1, $2, $3, $4, $5, $6, case when $5 = 'paga' then $7::timestamptz end, $7)
     on conflict (id) do update set
       valor_centavos = excluded.valor_centavos, vencimento = excluded.vencimento, situacao = excluded.situacao,
       link = coalesce(excluded.link, mensalidades.link),
       pago_em = case when excluded.situacao = 'paga' then coalesce(mensalidades.pago_em, excluded.pago_em) end,
       atualizado_em = excluded.atualizado_em`,
    [p.id, arenaId, p.valorCentavos, p.vencimento, situacao, p.link, agora],
  );
  return true;
}

// Cobrança excluída no Asaas (assinatura apagada ou alterada): sem efeito em dinheiro.
export async function cancelarCobrancaMensalidade(db: Pick<Db, "query">, pagamentoId: string, agora: Date): Promise<void> {
  await db.query(
    "update mensalidades set situacao = 'cancelada', atualizado_em = $2 where id = $1 and situacao in ('pendente', 'atrasada')",
    [pagamentoId, agora],
  );
}

export type Mensalidade = {
  id: string; valorCentavos: number; vencimento: string; situacao: string; link: string | null; pagoEm: Date | null;
};

export async function mensalidadesDaArena(db: Pick<Db, "query">, arenaId: string, limite = 6): Promise<Mensalidade[]> {
  if (typeof arenaId !== "string" || !UUID.test(arenaId)) return [];
  const { rows } = await db.query<{
    id: string; valor: number; vencimento: string; situacao: string; link: string | null; pago_em: Date | null;
  }>(
    `select id, valor_centavos as valor, to_char(vencimento, 'YYYY-MM-DD') as vencimento, situacao, link, pago_em
       from mensalidades where arena_id = $1 order by vencimento desc, id limit $2`,
    [arenaId, limite],
  );
  return rows.map((r) => ({
    id: r.id, valorCentavos: Number(r.valor), vencimento: r.vencimento, situacao: r.situacao, link: r.link,
    pagoEm: r.pago_em ? new Date(r.pago_em) : null,
  }));
}

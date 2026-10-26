import { textoPeriodo } from "@/app/minhas-reservas/apresentacao";
import { ErroAsaas, type Asaas, type PagamentoAsaas } from "./asaas";
import type { Db } from "./db";
import { segredoConfere } from "./limpeza";

// Pagamento online das reservas pelo Asaas: abrir o Checkout, processar o
// webhook e estornar. Spec: docs/superpowers/specs/2026-10-26-pagamento-asaas-design.md.
// Erros vão para o log só com a mensagem do cliente do Asaas (status e código).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
const mensagem = (e: unknown) => (e instanceof Error ? e.message : "erro");

// Abre (ou reabre) o Checkout de uma reserva online do jogador que ainda está
// segurada no prazo. Se o Asaas falhar ao criar, a reserva expira na hora e o
// horário volta a ficar livre.
export async function abrirPagamento(
  db: Pick<Db, "query">, asaas: Asaas, jogadorId: string, reservaId: string, appUrl: string,
): Promise<{ ok: true; link: string } | { ok: false }> {
  if (!ehUuid(jogadorId) || !ehUuid(reservaId)) return { ok: false };
  const { rows } = await db.query<{
    arena: string; quadra: string; carteira: string | null; taxa: string | number;
    inicio: Date; fim: Date; total: number; link: string | null;
  }>(
    `select a.nome as arena, q.nome as quadra, a.asaas_wallet_id as carteira, a.taxa_percentual as taxa,
            r.inicio, r.fim, r.total_centavos as total, r.asaas_checkout_link as link
       from reservas r
       join arenas a on a.id = r.arena_id
       join quadras q on q.id = r.quadra_id and q.arena_id = r.arena_id
      where r.id = $1 and r.jogador_id = $2 and r.tipo = 'reserva' and r.pagamento = 'online'
        and r.situacao = 'segurada' and r.segura_ate > now()`,
    [reservaId, jogadorId],
  );
  const l = rows[0];
  if (!l || !l.carteira) return { ok: false };
  if (l.link) return { ok: true, link: l.link };

  let checkout: { id: string; link: string };
  try {
    checkout = await asaas.criarCheckout({
      reservaId,
      item: l.quadra,
      descricao: `${l.arena} · ${textoPeriodo(l.inicio, l.fim)}`,
      totalCentavos: Number(l.total),
      carteiraDono: l.carteira,
      percentualDono: Math.round((100 - Number(l.taxa)) * 100) / 100,
      urlRetorno: `${appUrl}/minhas-reservas`,
    });
  } catch (e) {
    console.error("pagamento: Checkout não criado:", mensagem(e));
    await db.query("update reservas set situacao = 'expirada' where id = $1 and situacao = 'segurada'", [reservaId]);
    return { ok: false };
  }
  const gravou = await db.query<{ link: string }>(
    `update reservas set asaas_checkout_id = $2, asaas_checkout_link = $3
      where id = $1 and asaas_checkout_id is null returning asaas_checkout_link as link`,
    [reservaId, checkout.id, checkout.link],
  );
  if (gravou.rows[0]) return { ok: true, link: gravou.rows[0].link };
  // Dois cliques ao mesmo tempo: fica o primeiro Checkout; o outro é cancelado.
  await asaas.cancelarCheckout(checkout.id).catch((e) => console.error("pagamento: Checkout extra não cancelado:", mensagem(e)));
  const atual = await db.query<{ link: string }>("select asaas_checkout_link as link from reservas where id = $1", [reservaId]);
  return atual.rows[0]?.link ? { ok: true, link: atual.rows[0].link } : { ok: false };
}

// A arena da quadra cobra online (tem a carteira do dono vinculada)? A tela de
// confirmação usa para mostrar a forma de pagamento; quem decide é criarReserva.
export async function quadraCobraOnline(db: Pick<Db, "query">, quadraId: string): Promise<boolean> {
  if (!ehUuid(quadraId)) return false;
  const r = await db.query(
    `select 1 from quadras q join arenas a on a.id = q.arena_id where q.id = $1 and a.asaas_wallet_id is not null`,
    [quadraId],
  );
  return r.rows.length === 1;
}

// ---------- Estorno ----------

// "sem_tarifa": cancelamento pelo jogador ou pagamento atrasado — volta o
// líquido; o dono devolve o split inteiro e a Strukti a parte dela.
// "integral": cancelamento pelo dono — volta tudo; o dono devolve o split mais a
// tarifa. Se o Asaas não aceitar tirar do dono mais que o split, a diferença
// fica com a Strukti. Sucesso = "solicitado" (o webhook conclui); falha = "pendente".
export async function estornarReserva(
  db: Pick<Db, "query">, asaas: Asaas, reservaId: string, regra: "sem_tarifa" | "integral",
): Promise<boolean> {
  // Marca antes de chamar o Asaas: quem marca, estorna (duas chamadas ao mesmo
  // tempo não estornam duas vezes).
  const { rows } = await db.query<{ pagamento: string | null; carteira: string | null }>(
    `update reservas r set estorno = 'solicitado'
       from arenas a
      where r.id = $1 and a.id = r.arena_id and r.asaas_pagamento_id is not null and r.estorno is null
      returning r.asaas_pagamento_id as pagamento, a.asaas_wallet_id as carteira`,
    [reservaId],
  );
  const l = rows[0];
  if (!l?.pagamento) return false;
  const marcar = (estorno: "solicitado" | "pendente", centavos: number | null) =>
    db.query("update reservas set estorno = $2, estorno_centavos = $3 where id = $1", [reservaId, estorno, centavos]);
  try {
    const p = await asaas.pagamento(l.pagamento);
    const split = p.splits.find((s) => s.carteira === l.carteira) ?? p.splits[0];
    const tarifa = Math.max(0, p.valorCentavos - p.liquidoCentavos);
    const descricao = regra === "integral" ? "Reserva cancelada pela arena" : "Reserva cancelada (sem a tarifa do Asaas)";
    if (regra === "sem_tarifa") {
      await asaas.estornar(p.id, {
        valorCentavos: p.liquidoCentavos,
        splits: split ? [{ id: split.id, valorCentavos: split.valorCentavos }] : [],
        descricao,
      });
      await marcar("solicitado", p.liquidoCentavos);
      return true;
    }
    try {
      await asaas.estornar(p.id, {
        valorCentavos: p.valorCentavos,
        splits: split ? [{ id: split.id, valorCentavos: split.valorCentavos + tarifa }] : [],
        descricao,
      });
    } catch (e) {
      if (!(e instanceof ErroAsaas && e.status === 400) || !split) throw e;
      await asaas.estornar(p.id, { valorCentavos: p.valorCentavos, splits: [{ id: split.id, valorCentavos: split.valorCentavos }], descricao });
    }
    await marcar("solicitado", p.valorCentavos);
    return true;
  } catch (e) {
    console.error("pagamento: estorno não feito:", mensagem(e));
    await marcar("pendente", null);
    return false;
  }
}

// Depois que o jogador ou o dono cancelou: reserva paga online é estornada
// (regra conforme quem cancelou); segurada sem pagamento só tem o Checkout
// cancelado. Sem o Asaas configurado, o estorno fica pendente para a Strukti.
export async function estornarAposCancelar(
  db: Pick<Db, "query">, asaas: Asaas | null, reservaId: string,
): Promise<"solicitado" | "pendente" | "nada"> {
  if (!ehUuid(reservaId)) return "nada";
  const { rows } = await db.query<{
    situacao: string; pagamento: string | null; por: string | null; pago: string | null; checkout: string | null; estorno: string | null;
  }>(
    `select situacao, pagamento, cancelada_por as por, asaas_pagamento_id as pago, asaas_checkout_id as checkout, estorno
       from reservas where id = $1`,
    [reservaId],
  );
  const r = rows[0];
  if (!r || r.situacao !== "cancelada" || r.pagamento !== "online" || r.estorno) return "nada";
  if (!r.pago) {
    if (r.checkout && asaas) {
      await asaas.cancelarCheckout(r.checkout).catch((e) => console.error("pagamento: Checkout não cancelado:", mensagem(e)));
    }
    return "nada";
  }
  if (!asaas) {
    console.error("pagamento: estorno pendente (Asaas não configurado)");
    await db.query("update reservas set estorno = 'pendente' where id = $1 and estorno is null", [reservaId]);
    return "pendente";
  }
  return (await estornarReserva(db, asaas, reservaId, r.por === "dono" ? "integral" : "sem_tarifa")) ? "solicitado" : "pendente";
}

// ---------- Webhook ----------

const CONFIRMAM = new Set(["CHECKOUT_PAID", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);
const PAGO = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);
const texto = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null);

type Evento = {
  id: string; tipo: string;
  checkout: string | null; pagamento: string | null; referencia: string | null; sessao: string | null;
};

function lerEvento(e: unknown): Evento | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const id = texto(o.id);
  const tipo = texto(o.event);
  if (!id || !tipo) return null;
  const ck = (o.checkout && typeof o.checkout === "object" ? o.checkout : {}) as Record<string, unknown>;
  const pg = (o.payment && typeof o.payment === "object" ? o.payment : {}) as Record<string, unknown>;
  return {
    id, tipo, checkout: texto(ck.id), pagamento: texto(pg.id),
    referencia: texto(pg.externalReference), sessao: texto(pg.checkoutSession),
  };
}

async function acharReserva(db: Pick<Db, "query">, ev: { checkout: string | null; referencia: string | null }) {
  const { rows } = await db.query<{ id: string; total: number; checkout: string | null; pagamento: string | null }>(
    `select id, total_centavos as total, asaas_checkout_id as checkout, asaas_pagamento_id as pagamento
       from reservas
      where tipo = 'reserva' and pagamento = 'online'
        and (($1::text is not null and asaas_checkout_id = $1) or ($2::uuid is not null and id = $2::uuid))
      limit 1`,
    [ev.checkout, ev.referencia && ehUuid(ev.referencia) ? ev.referencia : null],
  );
  return rows[0] ?? null;
}

class ErroEvento extends Error {}

// Devolve o id da reserva quando este evento a confirmou (para os avisos).
async function confirmarPagamento(db: Pick<Db, "query">, asaas: Asaas, ev: Evento, agora: Date): Promise<string | null> {
  // Primeiro a reserva (evento de Checkout que não é nosso nem chama a API);
  // depois a cobrança, sempre lida da API (o evento é só o gatilho).
  let r = await acharReserva(db, { checkout: ev.checkout ?? ev.sessao, referencia: ev.referencia });
  if (!r && ev.tipo === "CHECKOUT_PAID") throw new ErroEvento("reserva não encontrada");
  let p: PagamentoAsaas | undefined;
  if (ev.tipo === "CHECKOUT_PAID") {
    if (ev.checkout) p = (await asaas.pagamentosDoCheckout(ev.checkout)).find((x) => PAGO.has(x.status));
  } else if (ev.pagamento) {
    p = await asaas.pagamento(ev.pagamento);
  }
  if (!p || !PAGO.has(p.status)) throw new ErroEvento("sem cobrança confirmada");
  r ??= await acharReserva(db, { checkout: p.checkout, referencia: null });
  if (!r) throw new ErroEvento("reserva não encontrada");
  if (r.pagamento) {
    if (r.pagamento !== p.id) throw new ErroEvento("outra cobrança para a mesma reserva");
    return null; // já processado por outro evento
  }
  if (r.checkout && p.checkout && r.checkout !== p.checkout) throw new ErroEvento("cobrança de outro Checkout");
  if (p.valorCentavos !== Number(r.total)) throw new ErroEvento("valor pago diferente do total");

  const dados = [r.id, p.id, p.valorCentavos, p.liquidoCentavos, agora];
  try {
    const ok = await db.query(
      `update reservas set situacao = 'confirmada', asaas_pagamento_id = $2, pago_centavos = $3,
              liquido_centavos = $4, pago_em = $5
        where id = $1 and asaas_pagamento_id is null and situacao in ('segurada', 'expirada') returning id`,
      dados,
    );
    if (ok.rows.length === 1) return r.id;
  } catch (e) {
    if ((e as { code?: string }).code !== "23P01") throw e;
  }
  // Horário já ocupado (pagou depois do prazo) ou reserva já cancelada: grava o
  // pagamento, cancela e estorna sem a tarifa. Só estorna quem gravou: se outro
  // evento da mesma cobrança confirmou no meio-tempo, nada muda e nada é estornado.
  const cancelou = await db.query(
    `update reservas set situacao = 'cancelada', cancelada_em = coalesce(cancelada_em, $5),
            motivo_cancelamento = coalesce(motivo_cancelamento, 'Pagamento depois do prazo; o horário já estava ocupado.'),
            asaas_pagamento_id = $2, pago_centavos = $3, liquido_centavos = $4, pago_em = $5
      where id = $1 and asaas_pagamento_id is null and situacao <> 'confirmada'
      returning id`,
    dados,
  );
  if (cancelou.rows.length === 1) await estornarReserva(db, asaas, r.id, "sem_tarifa");
  return null;
}

export type ResultadoEvento = "ok" | "repetido" | "ignorado" | "invalido" | "erro";

export async function processarEventoAsaas(
  db: Pick<Db, "query">, asaas: Asaas, bruto: unknown, agora: Date, aoConfirmar?: (reservaId: string) => void,
): Promise<ResultadoEvento> {
  const ev = lerEvento(bruto);
  if (!ev) return "invalido";
  const novo = await db.query(
    "insert into asaas_eventos (id, tipo, payload) values ($1, $2, $3::jsonb) on conflict (id) do nothing returning id",
    [ev.id, ev.tipo, JSON.stringify(bruto)],
  );
  if (novo.rows.length === 0) return "repetido";
  const fechar = (erro: string | null) =>
    db.query("update asaas_eventos set processado_em = $2, erro = $3 where id = $1", [ev.id, agora, erro]);
  try {
    if (CONFIRMAM.has(ev.tipo)) {
      const confirmada = await confirmarPagamento(db, asaas, ev, agora);
      if (confirmada) aoConfirmar?.(confirmada);
    } else if (ev.tipo === "CHECKOUT_EXPIRED" || ev.tipo === "CHECKOUT_CANCELED") {
      await db.query("update reservas set situacao = 'expirada' where asaas_checkout_id = $1 and situacao = 'segurada'", [ev.checkout]);
    } else if (ev.tipo === "PAYMENT_REFUNDED") {
      await db.query(
        "update reservas set estorno = 'concluido' where asaas_pagamento_id = $1 and estorno in ('solicitado', 'pendente')",
        [ev.pagamento],
      );
    } else {
      await fechar(null);
      return "ignorado";
    }
    await fechar(null);
    return "ok";
  } catch (e) {
    const erro = e instanceof ErroEvento ? e.message : mensagem(e);
    console.error(`asaas: evento ${ev.tipo} não processado: ${erro}`);
    await fechar(erro.slice(0, 200));
    return "erro";
  }
}

const json = (corpo: unknown, status: number) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// POST do Asaas com o cabeçalho asaas-access-token. Erro de processamento
// responde 200 mesmo assim: o evento fica gravado com o erro (visível no admin)
// e a fila do Asaas não pausa.
export function criarHandlerWebhookAsaas(
  db: Pick<Db, "query">, asaas: Asaas | null, token: string | undefined, relogio: () => Date = () => new Date(),
  aoConfirmar?: (reservaId: string) => void,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!token || !asaas) return json({ erro: "webhook não configurado" }, 503);
    if (!segredoConfere(req.headers.get("asaas-access-token") ?? "", token)) return json({ erro: "não autorizado" }, 401);
    let corpo: unknown;
    try {
      corpo = JSON.parse(await req.text());
    } catch {
      return json({ erro: "corpo inválido" }, 400);
    }
    const r = await processarEventoAsaas(db, asaas, corpo, relogio(), aoConfirmar);
    return json({ resultado: r }, r === "invalido" ? 400 : 200);
  };
}

import { textoPeriodo } from "@/app/minhas-reservas/apresentacao";
import type { Asaas } from "./asaas";
import type { Db } from "./db";

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

import { textoPeriodo } from "@/app/minhas-reservas/apresentacao";
import type { Db } from "./db";
import { hojeLocal, instanteDoMinuto, partesDoInstante } from "./disponibilidade";
import type { EnviarEmail, MensagemEmail } from "./email";
import { textoMinutos } from "./horarios";
import { lerBearer, segredoConfere } from "./limpeza";
import { textoDeCentavos } from "./precos";
import { podeCancelarJogador } from "./reservas";

// Avisos por e-mail das reservas: cancelamento (pelo jogador ou pela arena) e
// lembrete da véspera. Spec: docs/superpowers/specs/2026-10-25-emails-design.md.
// Falha de envio nunca lança para quem chamou: vai para o log sem e-mail nem texto.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

export type DadosAviso = {
  arena: string;
  endereco: string | null;
  quadra: string;
  esporte: string;
  inicio: Date;
  fim: Date;
  jogador: string | null; // null = conta apagada
  jogadorEmail: string | null;
  donos: string[];
  motivo: string | null;
  totalCentavos: number;
  situacao: string;
  canceladaPor: string | null;
  pagamento: string | null; // "arena" ou "online"
  estorno: string | null; // "solicitado", "concluido" ou "pendente"
  estornoCentavos: number | null;
};

type Linha = {
  arena: string; rua: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null;
  quadra: string; esporte: string; inicio: Date; fim: Date; jogador: string | null; jogador_email: string | null;
  donos: string[] | null; motivo: string | null; total: number | null; situacao: string; cancelada_por: string | null;
  pagamento: string | null; estorno: string | null; estorno_centavos: number | null;
};

// "Rua A, 10 · Centro · Fortaleza/CE" (bairro é opcional); sem rua, null.
function textoEndereco(l: Linha): string | null {
  if (!l.rua) return null;
  const partes = [`${l.rua}, ${l.numero ?? ""}`.trim(), l.bairro, l.cidade && l.uf ? `${l.cidade}/${l.uf}` : l.cidade];
  return partes.filter(Boolean).join(" · ");
}

// Só reserva de jogador (bloqueio não tem a quem avisar).
export async function dadosDoAviso(db: Pick<Db, "query">, reservaId: string): Promise<DadosAviso | null> {
  if (!ehUuid(reservaId)) return null;
  const { rows } = await db.query<Linha>(
    `select a.nome as arena, a.endereco_rua as rua, a.endereco_numero as numero, a.endereco_bairro as bairro,
            a.endereco_cidade as cidade, a.endereco_uf as uf, q.nome as quadra, q.esporte, r.inicio, r.fim,
            j.nome as jogador, j.email as jogador_email, r.motivo_cancelamento as motivo, r.total_centavos as total,
            r.situacao, r.cancelada_por, r.pagamento, r.estorno, r.estorno_centavos,
            (select array_agg(u.email order by u.email) from usuarios u where u.arena_id = a.id) as donos
       from reservas r
       join arenas a on a.id = r.arena_id
       join quadras q on q.id = r.quadra_id and q.arena_id = r.arena_id
       left join jogadores j on j.id = r.jogador_id
      where r.id = $1 and r.tipo = 'reserva'`,
    [reservaId],
  );
  const l = rows[0];
  if (!l) return null;
  return {
    arena: l.arena, endereco: textoEndereco(l), quadra: l.quadra, esporte: l.esporte, inicio: l.inicio, fim: l.fim,
    jogador: l.jogador, jogadorEmail: l.jogador_email, donos: l.donos ?? [], motivo: l.motivo,
    totalCentavos: Number(l.total ?? 0), situacao: l.situacao, canceladaPor: l.cancelada_por,
    pagamento: l.pagamento, estorno: l.estorno, estornoCentavos: l.estorno_centavos == null ? null : Number(l.estorno_centavos),
  };
}

// Base dos links dos e-mails, sem barra no fim. Vazia sem APP_URL (o log avisa).
export function urlDoApp(env: Record<string, string | undefined> = process.env): string {
  const url = (env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!url && env.NODE_ENV === "production") console.error("e-mail: APP_URL não configurada; links sem endereço");
  return url;
}

const rotuloQuadra = (d: DadosAviso) => (d.esporte ? `${d.quadra} (${d.esporte})` : d.quadra);
// Linhas do estorno de uma reserva paga online (vazio para "pagar na arena").
function textoEstorno(d: DadosAviso): string {
  if (d.pagamento !== "online" || !d.estorno) return "";
  if (d.estorno === "pendente" || d.estornoCentavos == null) {
    return "O estorno ainda não foi concluído; a Strukti vai resolver e avisar você.\n";
  }
  const como = d.canceladaPor === "dono" ? "o valor inteiro" : "o valor pago menos a tarifa do Asaas";
  return (
    `Estorno: ${textoDeCentavos(d.estornoCentavos)} (${como}).\n` +
    // Estorno pela API espera aprovação manual no Asaas (evento crítico).
    "O estorno passa por aprovação da Strukti. Depois de aprovado, no Pix o dinheiro volta em instantes; " +
    "no cartão, aparece na fatura em até 10 dias úteis.\n"
  );
}

const ASSINATURA = "\n\n—\nReplay, por Strukti. Este e-mail é automático; não precisa responder.";

export function mensagensDoCancelamento(d: DadosAviso, quem: "jogador" | "dono", appUrl: string): MensagemEmail[] {
  const periodo = textoPeriodo(d.inicio, d.fim);
  const nome = d.jogador ?? "Conta apagada";
  const msgs: MensagemEmail[] = [];
  if (quem === "jogador") {
    for (const dono of d.donos) {
      msgs.push({
        para: dono,
        assunto: `Reserva cancelada pelo jogador · ${d.quadra}`,
        texto:
          `${nome} cancelou a reserva de ${periodo}, na ${rotuloQuadra(d)}.\n` +
          `O horário voltou a ficar livre para reservas.\n` +
          (d.pagamento === "online" ? "O pagamento online volta ao jogador, menos a tarifa do Asaas.\n" : "") +
          `\n` +
          `Agenda do dia: ${appUrl}/painel/reservas?dia=${hojeLocal(d.inicio)}` + ASSINATURA,
      });
    }
    if (d.jogadorEmail) {
      msgs.push({
        para: d.jogadorEmail,
        assunto: `Reserva cancelada · ${d.arena}`,
        texto:
          `Sua reserva na ${d.arena} foi cancelada, como você pediu.\n` +
          `${periodo} · ${rotuloQuadra(d)}\n` +
          textoEstorno(d) +
          `\n` +
          `Suas reservas: ${appUrl}/minhas-reservas` + ASSINATURA,
      });
    }
  } else if (d.jogadorEmail) {
    msgs.push({
      para: d.jogadorEmail,
      assunto: `Sua reserva foi cancelada pela arena · ${d.arena}`,
      texto:
        `A ${d.arena} cancelou a sua reserva.\n` +
        `${periodo} · ${rotuloQuadra(d)}\n` +
        (d.motivo ? `Motivo: ${d.motivo}\n` : "") +
        textoEstorno(d) +
        `\nSe quiser, escolha outro horário: ${appUrl}/minhas-reservas` + ASSINATURA,
    });
  }
  return msgs;
}

// Pagamento online confirmado pelo webhook: confirmação ao jogador e aviso ao dono.
export function mensagensDoPagamento(d: DadosAviso, appUrl: string): MensagemEmail[] {
  const periodo = textoPeriodo(d.inicio, d.fim);
  const valor = textoDeCentavos(d.totalCentavos);
  const msgs: MensagemEmail[] = [];
  if (d.jogadorEmail) {
    msgs.push({
      para: d.jogadorEmail,
      assunto: `Reserva confirmada · ${d.arena}`,
      texto:
        `Pagamento de ${valor} recebido. Sua reserva está confirmada.\n\n` +
        `${d.arena}\n${periodo}\n${rotuloQuadra(d)}\n` +
        (d.endereco ? `${d.endereco}\n` : "") +
        `\nCancelamento até 24 h antes, em ${appUrl}/minhas-reservas (a tarifa do Asaas não é devolvida).` + ASSINATURA,
    });
  }
  for (const dono of d.donos) {
    msgs.push({
      para: dono,
      assunto: `Nova reserva paga · ${d.quadra}`,
      texto:
        `${d.jogador ?? "Conta apagada"} reservou e pagou online ${valor}: ${periodo}, na ${rotuloQuadra(d)}.\n` +
        `O valor cai na sua conta Asaas, menos a tarifa do Asaas e a taxa da Strukti.\n\n` +
        `Agenda do dia: ${appUrl}/painel/reservas?dia=${hojeLocal(d.inicio)}` + ASSINATURA,
    });
  }
  return msgs;
}

export async function avisarPagamento(
  db: Pick<Db, "query">, reservaId: string, enviar: EnviarEmail, appUrl: string,
): Promise<number> {
  let d: DadosAviso | null;
  try {
    d = await dadosDoAviso(db, reservaId);
  } catch (e) {
    console.error("e-mail: aviso de pagamento sem dados:", e instanceof Error ? e.message : "erro");
    return 0;
  }
  if (!d || d.situacao !== "confirmada" || d.pagamento !== "online") return 0;
  let n = 0;
  for (const m of mensagensDoPagamento(d, appUrl)) {
    if (await enviarSemLancar(enviar, m, "aviso de pagamento")) n++;
  }
  return n;
}

export function mensagemDoLembrete(d: DadosAviso, appUrl: string, agora: Date): MensagemEmail | null {
  if (!d.jogadorEmail) return null;
  const hora = textoMinutos(partesDoInstante(d.inicio).minuto);
  return {
    para: d.jogadorEmail,
    assunto: `Lembrete: amanhã às ${hora} · ${d.arena}`,
    texto:
      `Oi, ${d.jogador ?? ""}! Amanhã você joga na ${d.arena}.\n\n` +
      `${textoPeriodo(d.inicio, d.fim)}\n${rotuloQuadra(d)}\n` +
      (d.endereco ? `${d.endereco}\n` : "") +
      `Pagamento: ${textoDeCentavos(d.totalCentavos)}, ${d.pagamento === "online" ? "já pago online" : "na arena"}.\n\n` +
      (podeCancelarJogador(d.inicio, agora)
        ? d.pagamento === "online"
          ? `Precisa cancelar? Até 24 h antes, em ${appUrl}/minhas-reservas (a tarifa do Asaas não é devolvida).`
          : `Precisa cancelar? Até 24 h antes é grátis, em ${appUrl}/minhas-reservas`
        : `O prazo para cancelar pelo site já passou; se precisar, fale com a arena.\nSuas reservas: ${appUrl}/minhas-reservas`) +
      ASSINATURA,
  };
}

async function enviarSemLancar(enviar: EnviarEmail, m: MensagemEmail, contexto: string): Promise<boolean> {
  try {
    await enviar(m);
    return true;
  } catch (e) {
    console.error(`e-mail: ${contexto} não enviado:`, e instanceof Error ? e.message : "erro");
    return false;
  }
}

// Depois de um cancelamento: só manda se a reserva está mesmo cancelada por quem diz.
// Devolve quantos e-mails saíram.
export async function avisarCancelamento(
  db: Pick<Db, "query">, reservaId: string, quem: "jogador" | "dono", enviar: EnviarEmail, appUrl: string,
): Promise<number> {
  let d: DadosAviso | null;
  try {
    d = await dadosDoAviso(db, reservaId);
  } catch (e) {
    console.error("e-mail: aviso de cancelamento sem dados:", e instanceof Error ? e.message : "erro");
    return 0;
  }
  if (!d || d.situacao !== "cancelada" || d.canceladaPor !== quem) return 0;
  let n = 0;
  for (const m of mensagensDoCancelamento(d, quem, appUrl)) {
    if (await enviarSemLancar(enviar, m, "aviso de cancelamento")) n++;
  }
  return n;
}

const somaUmDia = (dia: string) => {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
};

// Tempo máximo de um cron de lembretes (a função tem 300 s na Vercel). O que
// não couber fica desmarcado; como o cron é diário, essas reservas ficam sem
// lembrete (o log avisa).
const PRAZO_LOTE_MS = 240_000;

// Lembrete da véspera: reservas confirmadas que começam amanhã (dia local),
// de arena ativa e com conta de jogador. Uma reserva por vez: marca (quem
// marca, envia; skip locked evita que dois crons peguem a mesma), envia e, se
// falhar, desmarca. Nada fica marcado sem ter sido enviado.
export async function enviarLembretes(
  db: Pick<Db, "query">, agora: Date, enviar: EnviarEmail, appUrl: string,
  esgotou: () => boolean = ((t0) => () => Date.now() - t0 > PRAZO_LOTE_MS)(Date.now()),
): Promise<{ enviados: number; falhas: number }> {
  const amanha = somaUmDia(hojeLocal(agora));
  const de = new Date(instanteDoMinuto(amanha, 0));
  const ate = new Date(instanteDoMinuto(somaUmDia(amanha), 0));
  let enviados = 0;
  let falhas = 0;
  const tentadas: string[] = []; // as que falharam neste cron não voltam no mesmo lote
  while (!esgotou()) {
    const { rows } = await db.query<{ id: string }>(
      `update reservas set lembrete_enviado_em = $3
        where id = (
          select r.id from reservas r join arenas a on a.id = r.arena_id
           where a.status_assinatura = 'ativa'
             and r.tipo = 'reserva' and r.situacao = 'confirmada' and r.jogador_id is not null
             and r.lembrete_enviado_em is null and r.inicio >= $1 and r.inicio < $2
             and not (r.id = any($4::uuid[]))
           order by r.inicio, r.id
           limit 1
           for update of r skip locked)
        returning id`,
      [de, ate, agora, tentadas],
    );
    const id = rows[0]?.id;
    if (!id) return { enviados, falhas };
    tentadas.push(id);
    let ok = false;
    try {
      const d = await dadosDoAviso(db, id);
      const m = d && mensagemDoLembrete(d, appUrl, agora);
      ok = !!m && (await enviarSemLancar(enviar, m, "lembrete"));
      if (m && !ok) falhas++;
    } finally {
      if (ok) enviados++;
      else await db.query("update reservas set lembrete_enviado_em = null where id = $1", [id]);
    }
  }
  console.error("lembretes: prazo do cron esgotado; reservas restantes ficaram sem lembrete");
  return { enviados, falhas };
}

const json = (corpo: unknown, status: number) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Cron diário da Vercel (GET com Authorization: Bearer <CRON_SECRET>), como a limpeza.
export function criarHandlerLembretes(
  db: Pick<Db, "query">, enviar: EnviarEmail, appUrl: string, segredo: string | undefined, relogio: () => Date = () => new Date(),
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!segredo) return json({ erro: "cron não configurado" }, 503);
    if (!segredoConfere(lerBearer(req), segredo)) return json({ erro: "não autorizado" }, 401);
    try {
      return json(await enviarLembretes(db, relogio(), enviar, appUrl), 200);
    } catch (e) {
      console.error("lembretes: falha:", e instanceof Error ? e.message : "erro");
      return json({ erro: "erro interno" }, 500);
    }
  };
}

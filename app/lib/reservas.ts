import { emTransacao, type Db } from "./db";
import { diaValido, horasOcupadas, instanteLocal, precoEscolha } from "./disponibilidade";
import { listarFaixas } from "./precos-quadra";
import { paraClipePublico, type ClipePublico, type LeitorR2, type LinhaClipe } from "./clipes";

// Reservas e bloqueios. Funções do dono recebem o arena_id da sessão; do
// jogador, o jogador_id da sessão: id de outra arena ou de outro jogador se
// comporta como inexistente. A não sobreposição é garantida pela exclusão da
// 0016 (23P01); as revalidações aqui só evitam gravar o que não cabe.

export const MSG_INDISPONIVEL = "Esse horário não está mais disponível.";
export const MSG_BLOQUEIO_OCUPADO = "Já existe reserva ou bloqueio nesse horário.";
export const MSG_LIMITE_RESERVAS = "Você atingiu o limite de reservas futuras. Cancele uma ou aguarde o jogo.";
// Sem pagamento online, o limite impede que um jogador tome todos os horários.
export const LIMITE_RESERVAS_POR_ARENA = 2;
export const LIMITE_RESERVAS_TOTAL = 5;
export const MOTIVO_CANCELAMENTO_MAX = 120;
export const MOTIVO_BLOQUEIO_MAX = 60;
const ANTECEDENCIA_CANCELAR_MS = 24 * 3_600_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
const DIA = /^\d{4}-\d{2}-\d{2}$/;

const violouExclusao = (e: unknown) => (e as { code?: string }).code === "23P01";

// Clipes de lance de uma reserva: pronto/parcial, não expirados, das câmeras da
// quadra, recebidos em [inicio, fim). `r` é o alias da reserva na consulta.
const CLIPES_DA_JANELA = `
  from clipes c
  join cameras cam on cam.id = c.camera_id and cam.arena_id = c.arena_id
 where cam.quadra_id = r.quadra_id
   and cam.arena_id = r.arena_id
   and c.arena_id = r.arena_id
   and c.status in ('pronto', 'parcial')
   and c.chave_r2 is not null
   and c.expira_em > now()
   and c.recebido_em >= r.inicio
   and c.recebido_em < r.fim`;

// Segura vencida deixa de ocupar: vira expirada antes de gravar na quadra, para
// não esbarrar na exclusão.
async function expirarSeguradas(tx: Pick<Db, "query">, quadraId: string): Promise<void> {
  await tx.query(
    "update reservas set situacao = 'expirada' where quadra_id = $1 and situacao = 'segurada' and segura_ate <= now()",
    [quadraId],
  );
}

// Períodos que ocupam a quadra e tocam o dia local: confirmadas e seguradas
// ainda no prazo (reservas e bloqueios).
export async function periodosOcupados(
  db: Pick<Db, "query">, arenaId: string, quadraId: string, dia: string,
): Promise<{ inicio: Date; fim: Date }[]> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId) || typeof dia !== "string" || !DIA.test(dia)) return [];
  const { rows } = await db.query<{ inicio: Date; fim: Date }>(
    `select inicio, fim from reservas
      where quadra_id = $1 and arena_id = $2
        and (situacao = 'confirmada' or (situacao = 'segurada' and segura_ate > now()))
        and periodo && tstzrange($3::timestamptz, $4::timestamptz, '[)')
      order by inicio`,
    [quadraId, arenaId, new Date(instanteLocal(dia, 0)), new Date(instanteLocal(dia, 24))],
  );
  return rows.map((r) => ({ inicio: new Date(r.inicio), fim: new Date(r.fim) }));
}

export async function criarReserva(
  db: Db,
  jogadorId: string,
  e: { quadraId: string; dia: string; inicio: number; horas: number },
  agora: Date,
): Promise<{ ok: true; reservaId: string } | { ok: false; erro: string }> {
  const recusa = { ok: false as const, erro: MSG_INDISPONIVEL };
  if (!ehUuid(jogadorId) || !ehUuid(e?.quadraId)) return recusa;
  const dia = diaValido(e.dia, agora);
  if (!dia) return recusa;

  // Quadra de arena ativa; o motivo da recusa não é revelado.
  const q = await db.query<{ arena_id: string }>(
    `select q.arena_id from quadras q join arenas a on a.id = q.arena_id
      where q.id = $1 and a.status_assinatura = 'ativa'`,
    [e.quadraId],
  );
  const arenaId = q.rows[0]?.arena_id;
  if (!arenaId) return recusa;
  const faixas = await listarFaixas(db, arenaId, e.quadraId);
  if (faixas.length === 0) return recusa;
  const ocupadas = horasOcupadas(await periodosOcupados(db, arenaId, e.quadraId, dia), dia);
  const escolha = precoEscolha(faixas, dia, e.inicio, e.horas, agora, ocupadas);
  if (!escolha) return recusa;

  try {
    const r = await emTransacao(db, async (tx): Promise<{ ok: true; reservaId: string } | { ok: false; erro: string }> => {
      // Trava a linha do jogador: apagarContaJogador (for update) espera esta
      // transação, e duas reservas do mesmo jogador passam uma de cada vez, então
      // o limite não fura. for no key update e não for share: com for share as
      // duas leriam a mesma contagem ao mesmo tempo. Não conflita com a trava de
      // chave estrangeira (for key share) que o insert em reservas pega.
      // A contagem vem num comando seguinte, com snapshot novo depois da espera.
      const j = await tx.query("select 1 from jogadores where id = $1 for no key update", [jogadorId]);
      if (j.rows.length === 0) return recusa;
      const n = await tx.query<{ arena: number; total: number }>(
        `select count(*) filter (where arena_id = $2)::int as arena, count(*)::int as total
           from reservas
          where jogador_id = $1 and tipo = 'reserva' and situacao = 'confirmada' and fim > $3::timestamptz`,
        [jogadorId, arenaId, agora],
      );
      const c = n.rows[0];
      if (Number(c.arena) >= LIMITE_RESERVAS_POR_ARENA || Number(c.total) >= LIMITE_RESERVAS_TOTAL) {
        return { ok: false, erro: MSG_LIMITE_RESERVAS };
      }
      await expirarSeguradas(tx, e.quadraId);
      const ins = await tx.query<{ id: string }>(
        `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim,
                               pagamento, total_centavos, taxa_centavos, detalhe)
         values ($1, $2, $3, 'reserva', 'confirmada', $4, $5, 'arena', $6, 0, $7::jsonb) returning id`,
        [
          arenaId, e.quadraId, jogadorId,
          new Date(instanteLocal(dia, escolha.hora)), new Date(instanteLocal(dia, escolha.hora + escolha.horas)),
          escolha.totalCentavos, JSON.stringify(escolha.porHora),
        ],
      );
      return { ok: true, reservaId: ins.rows[0].id };
    });
    return r;
  } catch (err) {
    if (violouExclusao(err)) return recusa;
    throw err;
  }
}

// Jogador: só a própria reserva confirmada, até 24 h antes do início (instantes).
export async function cancelarPeloJogador(db: Db, jogadorId: string, reservaId: string, agora: Date): Promise<boolean> {
  if (!ehUuid(jogadorId) || !ehUuid(reservaId)) return false;
  const r = await db.query(
    `update reservas set situacao = 'cancelada', cancelada_em = now(), cancelada_por = 'jogador'
      where id = $1 and jogador_id = $2 and tipo = 'reserva' and situacao = 'confirmada'
        and inicio - $3::timestamptz >= interval '24 hours'
      returning id`,
    [reservaId, jogadorId, agora],
  );
  return r.rows.length === 1;
}

export function podeCancelarJogador(inicio: Date, agora: Date): boolean {
  return inicio.getTime() - agora.getTime() >= ANTECEDENCIA_CANCELAR_MS;
}

// Dono: qualquer reserva ou bloqueio da arena que ainda não começou, com motivo
// opcional (até 120). Bloqueio removido também vira cancelada.
export async function cancelarPeloDono(
  db: Db, arenaId: string, reservaId: string, motivo?: string, agora: Date = new Date(),
): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(reservaId)) return false;
  const limpo = typeof motivo === "string" ? motivo.trim() : "";
  if (limpo.length > MOTIVO_CANCELAMENTO_MAX) return false;
  const r = await db.query(
    `update reservas set situacao = 'cancelada', cancelada_em = now(), cancelada_por = 'dono',
                         motivo_cancelamento = $3
      where id = $1 and arena_id = $2 and situacao in ('confirmada', 'segurada') and inicio > $4::timestamptz
      returning id`,
    [reservaId, arenaId, limpo || null, agora],
  );
  return r.rows.length === 1;
}

export async function bloquearHorario(
  db: Db,
  arenaId: string,
  e: { quadraId: string; dia: string; inicio: number; fim: number; motivo: string },
  agora: Date,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!ehUuid(arenaId) || !ehUuid(e?.quadraId)) return { ok: false, erro: "Quadra não encontrada." };
  const dia = diaValido(e.dia, agora);
  if (!dia) return { ok: false, erro: "Dia inválido." };
  const { inicio, fim } = e;
  if (!Number.isInteger(inicio) || !Number.isInteger(fim) || inicio < 0 || fim > 24 || fim <= inicio || fim - inicio > 12) {
    return { ok: false, erro: "Horário inválido." };
  }
  const de = instanteLocal(dia, inicio);
  if (de <= agora.getTime()) return { ok: false, erro: "Horário inválido." };
  const motivo = typeof e.motivo === "string" ? e.motivo.trim() : "";
  if (motivo.length < 1 || motivo.length > MOTIVO_BLOQUEIO_MAX) {
    return { ok: false, erro: `Informe o motivo (até ${MOTIVO_BLOQUEIO_MAX} caracteres).` };
  }

  try {
    return await emTransacao(db, async (tx) => {
      const q = await tx.query("select 1 from quadras where id = $1 and arena_id = $2", [e.quadraId, arenaId]);
      if (q.rows.length === 0) return { ok: false as const, erro: "Quadra não encontrada." };
      await expirarSeguradas(tx, e.quadraId);
      await tx.query(
        `insert into reservas (arena_id, quadra_id, tipo, situacao, inicio, fim, motivo)
         values ($1, $2, 'bloqueio', 'confirmada', $3, $4, $5)`,
        [arenaId, e.quadraId, new Date(de), new Date(instanteLocal(dia, fim)), motivo],
      );
      return { ok: true as const };
    });
  } catch (err) {
    if (violouExclusao(err)) return { ok: false, erro: MSG_BLOQUEIO_OCUPADO };
    throw err;
  }
}

export type ReservaJogador = {
  id: string;
  arena: { nome: string; slug: string };
  quadra: string;
  inicio: Date;
  fim: Date;
  totalCentavos: number;
  pagamento: string;
  situacao: string;
  canceladaPor: string | null;
  podeCancelar: boolean;
  lances: number;
};

// Próximas: confirmadas que ainda não terminaram, da mais próxima à mais
// distante. Histórico: passadas e canceladas, mais recentes primeiro.
export async function reservasDoJogador(
  db: Db, jogadorId: string, agora: Date,
): Promise<{ proximas: ReservaJogador[]; historico: ReservaJogador[] }> {
  if (!ehUuid(jogadorId)) return { proximas: [], historico: [] };
  const { rows } = await db.query<{
    id: string; arena_nome: string; arena_slug: string; quadra: string; inicio: Date; fim: Date;
    total_centavos: number; pagamento: string; situacao: string; cancelada_por: string | null; lances: number;
  }>(
    `select r.id, a.nome as arena_nome, a.slug as arena_slug, q.nome as quadra, r.inicio, r.fim,
            r.total_centavos, r.pagamento, r.situacao, r.cancelada_por,
            case when r.situacao = 'confirmada' then (select count(*)::int ${CLIPES_DA_JANELA}) else 0 end as lances
       from reservas r
       join arenas a on a.id = r.arena_id
       join quadras q on q.id = r.quadra_id and q.arena_id = r.arena_id
      where r.jogador_id = $1 and r.tipo = 'reserva' and r.situacao in ('confirmada', 'cancelada')
      order by r.inicio desc, r.criado_em desc, r.id`,
    [jogadorId],
  );
  const lista: ReservaJogador[] = rows.map((r) => {
    const inicio = new Date(r.inicio);
    return {
      id: r.id,
      arena: { nome: r.arena_nome, slug: r.arena_slug },
      quadra: r.quadra,
      inicio,
      fim: new Date(r.fim),
      totalCentavos: Number(r.total_centavos),
      pagamento: r.pagamento,
      situacao: r.situacao,
      canceladaPor: r.cancelada_por,
      podeCancelar: r.situacao === "confirmada" && podeCancelarJogador(inicio, agora),
      lances: Number(r.lances),
    };
  });
  const proxima = (r: ReservaJogador) => r.situacao === "confirmada" && r.fim.getTime() > agora.getTime();
  return { proximas: lista.filter(proxima).reverse(), historico: lista.filter((r) => !proxima(r)) };
}

export type ItemAgenda = {
  id: string;
  tipo: "reserva" | "bloqueio";
  quadra: string;
  inicio: Date;
  fim: Date;
  situacao: string;
  jogador: string | null; // nome, "Conta apagada" ou null (bloqueio)
  totalCentavos: number | null;
  motivo: string | null;
  canceladaPor: string | null;
  futura: boolean; // ainda não começou: o dono pode cancelar
};

// Agenda do dono entre os dias locais `de` e `ate` (inclusive). Do jogador, só o nome.
export async function agendaDaArena(
  db: Db, arenaId: string, agora: Date, intervalo: { de: string; ate: string },
): Promise<ItemAgenda[]> {
  const { de, ate } = intervalo ?? {};
  if (!ehUuid(arenaId) || typeof de !== "string" || typeof ate !== "string" || !DIA.test(de) || !DIA.test(ate)) return [];
  const { rows } = await db.query<{
    id: string; tipo: "reserva" | "bloqueio"; quadra: string; inicio: Date; fim: Date; situacao: string;
    jogador: string | null; total_centavos: number | null; motivo: string | null; cancelada_por: string | null;
  }>(
    `select r.id, r.tipo, q.nome as quadra, r.inicio, r.fim, r.situacao,
            case when r.tipo = 'reserva' then coalesce(j.nome, 'Conta apagada') end as jogador,
            r.total_centavos, r.motivo, r.cancelada_por
       from reservas r
       join quadras q on q.id = r.quadra_id and q.arena_id = r.arena_id
       left join jogadores j on j.id = r.jogador_id
      where r.arena_id = $1 and r.situacao in ('confirmada', 'cancelada')
        and r.inicio < $3::timestamptz and r.fim > $2::timestamptz
      order by r.inicio, q.nome, r.id`,
    [arenaId, new Date(instanteLocal(de, 0)), new Date(instanteLocal(ate, 24))],
  );
  return rows.map((r) => ({
    id: r.id,
    tipo: r.tipo,
    quadra: r.quadra,
    inicio: new Date(r.inicio),
    fim: new Date(r.fim),
    situacao: r.situacao,
    jogador: r.jogador,
    totalCentavos: r.total_centavos === null ? null : Number(r.total_centavos),
    motivo: r.motivo,
    canceladaPor: r.cancelada_por,
    futura: new Date(r.inicio).getTime() > agora.getTime(),
  }));
}

// Lances da reserva para o jogador dela (confirmada, inclusive depois do jogo).
// Reserva de outro jogador, cancelada ou inexistente: null.
export async function lancesDaReservaDoJogador(
  db: Db, r2: LeitorR2, jogadorId: string, reservaId: string,
): Promise<ClipePublico[] | null> {
  if (!ehUuid(jogadorId) || !ehUuid(reservaId)) return null;
  const r = await db.query<{ arena_id: string }>(
    `select arena_id from reservas
      where id = $1 and jogador_id = $2 and tipo = 'reserva' and situacao = 'confirmada'`,
    [reservaId, jogadorId],
  );
  const arenaId = r.rows[0]?.arena_id;
  if (!arenaId) return null;
  const { rows } = await db.query<LinhaClipe>(
    `select c.id, c.recebido_em, c.duracao, c.status, c.chave_r2
       from reservas r, lateral (select c.* ${CLIPES_DA_JANELA}) c
      where r.id = $1 and r.arena_id = $2
      order by c.recebido_em, c.id`,
    [reservaId, arenaId],
  );
  return Promise.all(rows.map((c) => paraClipePublico(r2, arenaId, c)));
}

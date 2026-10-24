import { emTransacao, type Db } from "./db";
import { diaDaSemana, instanteDoMinuto, partesDoInstante } from "./disponibilidade";
import {
  primeiroChoque, separarChoques, textoIntervalo, validarHorario, type Horario, type HorarioComId,
} from "./horarios";

// Horários do dono no banco. Sempre recebe o arena_id da sessão: quadra ou
// horário de outra arena se comporta como inexistente.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

const LOTE_MAX = 672;
const MSG_CHOQUE = "Esse horário choca com outro horário.";
const MSG_SEM_QUADRA = "Quadra não encontrada.";

type Linha = { id: string; dia_semana: number; inicio: number; fim: number; preco_centavos: number };

const paraHorario = (r: Linha): HorarioComId => ({
  id: r.id,
  diaSemana: Number(r.dia_semana),
  inicio: Number(r.inicio),
  fim: Number(r.fim),
  precoCentavos: Number(r.preco_centavos),
});

const COLUNAS = "id, dia_semana, inicio, fim, preco_centavos";

// 23P01 = exclusion_violation: outro pedido gravou um horário que choca.
const ehChoque = (e: unknown) => (e as { code?: string } | null)?.code === "23P01";

export async function listarHorarios(db: Db, arenaId: string, quadraId: string): Promise<HorarioComId[]> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return [];
  const { rows } = await db.query<Linha>(
    `select ${COLUNAS} from horarios_quadra
      where quadra_id = $1 and arena_id = $2
      order by dia_semana, inicio, id`,
    [quadraId, arenaId],
  );
  return rows.map(paraHorario);
}

// Insere vários horários num comando só: ou entram todos, ou nenhum.
const INSERIR = `insert into horarios_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos)
  select $1, $2, d, i, f, p
    from unnest($3::smallint[], $4::smallint[], $5::smallint[], $6::int[]) as t(d, i, f, p)`;

const gravar = (tx: Db, arenaId: string, quadraId: string, hs: Horario[]) =>
  tx.query(INSERIR, [
    arenaId, quadraId,
    hs.map((x) => x.diaSemana), hs.map((x) => x.inicio), hs.map((x) => x.fim), hs.map((x) => x.precoCentavos),
  ]);

// Trava a quadra (for no key update) e só depois lê os horários, em comandos
// separados: em read committed cada comando tira um snapshot novo, então o
// segundo de dois pedidos simultâneos enxerga o que o primeiro gravou.
async function comQuadraTravada<T>(
  db: Db, arenaId: string, quadraId: string, corpo: (tx: Db) => Promise<T>,
): Promise<T | { ok: false; erro: string }> {
  try {
    return await emTransacao(db, async (tx) => {
      const q = await tx.query("select id from quadras where id = $1 and arena_id = $2 for no key update", [quadraId, arenaId]);
      if (q.rows.length === 0) return { ok: false as const, erro: MSG_SEM_QUADRA };
      return corpo(tx);
    });
  } catch (e) {
    if (ehChoque(e)) return { ok: false, erro: MSG_CHOQUE };
    throw e;
  }
}

const lerDaQuadra = async (tx: Db, arenaId: string, quadraId: string) =>
  (await tx.query<Linha>(
    `select ${COLUNAS} from horarios_quadra where quadra_id = $1 and arena_id = $2`, [quadraId, arenaId],
  )).rows.map(paraHorario);

export async function criarHorario(
  db: Db, arenaId: string, quadraId: string, h: Horario,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return { ok: false, erro: MSG_SEM_QUADRA };
  const erro = validarHorario(h);
  if (erro) return { ok: false, erro };
  return comQuadraTravada(db, arenaId, quadraId, async (tx) => {
    const choque = primeiroChoque(h, await lerDaQuadra(tx, arenaId, quadraId));
    if (choque) return { ok: false as const, erro: `Esse horário choca com ${textoIntervalo(choque)}.` };
    const r = await tx.query<{ id: string }>(
      `insert into horarios_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [arenaId, quadraId, h.diaSemana, h.inicio, h.fim, h.precoCentavos],
    );
    return { ok: true as const, id: r.rows[0].id };
  });
}

// Valida todos (um inválido recusa a leva), pula os que chocam com os existentes
// e grava o resto. Dois da própria leva que chocam entre si caem na exclusão do
// banco e a leva inteira é recusada.
export async function criarHorarios(
  db: Db, arenaId: string, quadraId: string, novos: Horario[],
): Promise<{ ok: true; criados: number; pulados: number } | { ok: false; erro: string }> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return { ok: false, erro: MSG_SEM_QUADRA };
  if (novos.length === 0) return { ok: false, erro: "Nenhum horário para criar." };
  if (novos.length > LOTE_MAX) return { ok: false, erro: "Horários demais de uma vez." };
  for (const n of novos) {
    const erro = validarHorario(n);
    if (erro) return { ok: false, erro };
  }
  return comQuadraTravada(db, arenaId, quadraId, async (tx) => {
    const { criar, pulados } = separarChoques(novos, await lerDaQuadra(tx, arenaId, quadraId));
    if (criar.length > 0) await gravar(tx, arenaId, quadraId, criar);
    return { ok: true as const, criados: criar.length, pulados: pulados.length };
  });
}

export async function editarHorario(
  db: Db, arenaId: string, horarioId: string, h: { inicio: number; fim: number; precoCentavos: number },
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const NAO = { ok: false as const, erro: "Horário não encontrado." };
  if (!ehUuid(arenaId) || !ehUuid(horarioId)) return NAO;
  try {
    return await emTransacao(db, async (tx) => {
      // Trava a quadra do horário; o horário é relido depois, já com a trava.
      const q = await tx.query<{ quadra_id: string }>(
        "select quadra_id from horarios_quadra where id = $1 and arena_id = $2", [horarioId, arenaId]);
      if (q.rows.length === 0) return NAO;
      const quadraId = q.rows[0].quadra_id;
      await tx.query("select id from quadras where id = $1 and arena_id = $2 for no key update", [quadraId, arenaId]);
      const atual = (await tx.query<Linha>(
        `select ${COLUNAS} from horarios_quadra where id = $1 and arena_id = $2`, [horarioId, arenaId])).rows[0];
      if (!atual) return NAO;
      const novo: Horario = { diaSemana: Number(atual.dia_semana), ...h };
      const erro = validarHorario(novo);
      if (erro) return { ok: false as const, erro };
      const choque = primeiroChoque(novo, await lerDaQuadra(tx, arenaId, quadraId), horarioId);
      if (choque) return { ok: false as const, erro: `Esse horário choca com ${textoIntervalo(choque)}.` };
      await tx.query(
        "update horarios_quadra set inicio = $3, fim = $4, preco_centavos = $5 where id = $1 and arena_id = $2",
        [horarioId, arenaId, h.inicio, h.fim, h.precoCentavos],
      );
      return { ok: true as const };
    });
  } catch (e) {
    if (ehChoque(e)) return { ok: false, erro: MSG_CHOQUE };
    throw e;
  }
}

export async function apagarHorario(db: Db, arenaId: string, horarioId: string): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(horarioId)) return false;
  const r = await db.query("delete from horarios_quadra where id = $1 and arena_id = $2 returning id", [horarioId, arenaId]);
  return r.rows.length === 1;
}

// Copia os horários do dia `origem` para cada dia de `destinos`; os que chocam
// com o que já existe no destino são pulados.
export async function copiarDia(
  db: Db, arenaId: string, quadraId: string, origem: number, destinos: number[],
): Promise<{ ok: true; criados: number; pulados: number } | { ok: false; erro: string }> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return { ok: false, erro: MSG_SEM_QUADRA };
  const dias = [...new Set(destinos)].filter((d) => d !== origem).sort((x, y) => x - y);
  if (dias.length === 0) return { ok: false, erro: "Marque pelo menos um dia." };
  if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { ok: false, erro: "Dia da semana inválido." };
  return comQuadraTravada(db, arenaId, quadraId, async (tx) => {
    const todos = await lerDaQuadra(tx, arenaId, quadraId);
    const doOrigem = todos.filter((x) => x.diaSemana === origem);
    if (doOrigem.length === 0) return { ok: false as const, erro: "Esse dia não tem horários para copiar." };
    const novos = dias.flatMap((d) => doOrigem.map((x) => ({ diaSemana: d, inicio: x.inicio, fim: x.fim, precoCentavos: x.precoCentavos })));
    const { criar, pulados } = separarChoques(novos, todos);
    if (criar.length > 0) await gravar(tx, arenaId, quadraId, criar);
    return { ok: true as const, criados: criar.length, pulados: pulados.length };
  });
}

// Quantas reservas de jogador, confirmadas e ainda por vir, tocam cada horário
// (mesmo dia da semana local e minutos que se sobrepõem). Horário sem reserva
// fica fora do objeto.
export async function reservasFuturasPorHorario(
  db: Db, arenaId: string, quadraId: string, agora: Date,
): Promise<Record<string, number>> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return {};
  const horarios = await listarHorarios(db, arenaId, quadraId);
  if (horarios.length === 0) return {};
  const { rows } = await db.query<{ inicio: Date | string; fim: Date | string }>(
    `select inicio, fim from reservas
      where quadra_id = $1 and arena_id = $2 and tipo = 'reserva' and situacao = 'confirmada' and inicio > $3`,
    [quadraId, arenaId, agora],
  );
  const saida: Record<string, number> = {};
  for (const r of rows) {
    const ini = partesDoInstante(new Date(r.inicio));
    const dia = diaDaSemana(ini.dia);
    const fimMs = new Date(r.fim).getTime();
    const iniMs = new Date(r.inicio).getTime();
    for (const h of horarios) {
      if (h.diaSemana !== dia) continue;
      // Confronta em instantes do mesmo dia local, o que cobre reservas que passam da meia-noite.
      if (iniMs < instanteDoMinuto(ini.dia, h.fim) && fimMs > instanteDoMinuto(ini.dia, h.inicio)) {
        saida[h.id] = (saida[h.id] ?? 0) + 1;
      }
    }
  }
  return saida;
}

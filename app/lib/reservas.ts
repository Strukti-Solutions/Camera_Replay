import { emTransacao, type Db } from "./db";
import { diaDaSemana, diaValido, escolhaDeHorarios, hojeLocal, instanteDoMinuto, instanteLocal } from "./disponibilidade";
import { normalizar, sqlNorm } from "./texto-busca";
import { listarHorarios } from "./horarios-quadra";
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
// Quanto tempo o horário fica segurado esperando o pagamento online (o Checkout do Asaas vale o mesmo).
export const PRAZO_PAGAMENTO_MS = 10 * 60_000;
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
  return periodosOcupadosEntre(db, arenaId, quadraId, dia, dia);
}

// Mesmo critério, para os dias locais de `de` a `ate` (inclusive): o calendário
// da página da arena pede a janela inteira numa consulta só.
export async function periodosOcupadosEntre(
  db: Pick<Db, "query">, arenaId: string, quadraId: string, de: string, ate: string,
): Promise<{ inicio: Date; fim: Date }[]> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return [];
  if (typeof de !== "string" || !DIA.test(de) || typeof ate !== "string" || !DIA.test(ate)) return [];
  const { rows } = await db.query<{ inicio: Date; fim: Date }>(
    `select inicio, fim from reservas
      where quadra_id = $1 and arena_id = $2
        and (situacao = 'confirmada' or (situacao = 'segurada' and segura_ate > now()))
        and periodo && tstzrange($3::timestamptz, $4::timestamptz, '[)')
      order by inicio`,
    [quadraId, arenaId, new Date(instanteDoMinuto(de, 0)), new Date(instanteDoMinuto(ate, 1440))],
  );
  return rows.map((r) => ({ inicio: new Date(r.inicio), fim: new Date(r.fim) }));
}

export async function criarReserva(
  db: Db,
  jogadorId: string,
  e: { quadraId: string; dia: string; inicio: number; qtd: number },
  agora: Date,
  opcoes: { online?: boolean } = {},
): Promise<{ ok: true; reservaId: string; pagarOnline: boolean } | { ok: false; erro: string }> {
  const recusa = { ok: false as const, erro: MSG_INDISPONIVEL };
  if (!ehUuid(jogadorId) || !ehUuid(e?.quadraId)) return recusa;
  const dia = diaValido(e.dia, agora);
  if (!dia) return recusa;

  // Quadra de arena ativa; o motivo da recusa não é revelado.
  const q = await db.query<{ arena_id: string; carteira: string | null; taxa: string | number }>(
    `select q.arena_id, a.asaas_wallet_id as carteira, a.taxa_percentual as taxa
       from quadras q join arenas a on a.id = q.arena_id
      where q.id = $1 and a.status_assinatura = 'ativa'`,
    [e.quadraId],
  );
  const arenaId = q.rows[0]?.arena_id;
  // Online só com o Asaas configurado (quem chama diz) e a carteira do dono
  // vinculada; senão, "pagar na arena", confirmada na hora (fase 4a).
  const online = opcoes.online === true && !!q.rows[0]?.carteira;
  if (!arenaId) return recusa;
  const horarios = await listarHorarios(db, arenaId, e.quadraId);
  if (horarios.length === 0) return recusa;
  const ocupados = await periodosOcupados(db, arenaId, e.quadraId, dia);
  const escolha = escolhaDeHorarios(horarios, dia, e.inicio, e.qtd, agora, ocupados);
  if (!escolha) return recusa;

  try {
    const r = await emTransacao(db, async (tx): Promise<{ ok: true; reservaId: string; pagarOnline: boolean } | { ok: false; erro: string }> => {
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
          where jogador_id = $1 and tipo = 'reserva' and fim > $3::timestamptz
            and (situacao = 'confirmada' or (situacao = 'segurada' and segura_ate > $3::timestamptz))`,
        [jogadorId, arenaId, agora],
      );
      const c = n.rows[0];
      if (Number(c.arena) >= LIMITE_RESERVAS_POR_ARENA || Number(c.total) >= LIMITE_RESERVAS_TOTAL) {
        return { ok: false, erro: MSG_LIMITE_RESERVAS };
      }
      await expirarSeguradas(tx, e.quadraId);
      // Online: segurada por 10 min até o webhook do Asaas confirmar; a taxa é
      // a estimativa sobre o bruto (o split real é sobre o líquido).
      const taxa = online ? Math.round((escolha.totalCentavos * Number(q.rows[0].taxa)) / 100) : 0;
      const ins = await tx.query<{ id: string }>(
        `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, segura_ate, inicio, fim,
                               pagamento, total_centavos, taxa_centavos, detalhe)
         values ($1, $2, $3, 'reserva', $8, $9, $4, $5, $10, $6, $11, $7::jsonb) returning id`,
        [
          arenaId, e.quadraId, jogadorId,
          new Date(instanteDoMinuto(dia, escolha.inicio)), new Date(instanteDoMinuto(dia, escolha.fim)),
          escolha.totalCentavos, JSON.stringify(escolha.itens),
          online ? "segurada" : "confirmada", online ? new Date(agora.getTime() + PRAZO_PAGAMENTO_MS) : null,
          online ? "online" : "arena", taxa,
        ],
      );
      return { ok: true, reservaId: ins.rows[0].id, pagarOnline: online };
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

// Dono remove um bloqueio da arena que ainda não começou. Reserva de jogador,
// de outra arena ou inexistente: false (para cancelar reserva, cancelarPeloDono).
export async function removerBloqueio(db: Db, arenaId: string, bloqueioId: string, agora: Date): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(bloqueioId)) return false;
  const r = await db.query(
    `update reservas set situacao = 'cancelada', cancelada_em = now(), cancelada_por = 'dono'
      where id = $1 and arena_id = $2 and tipo = 'bloqueio' and situacao = 'confirmada' and inicio > $3::timestamptz
      returning id`,
    [bloqueioId, arenaId, agora],
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

// Super admin: reservas de jogador confirmadas que ainda não começaram, por
// arena (uma consulta para a lista toda). Arena sem nenhuma fica fora do mapa.
export async function reservasFuturasPorArena(db: Pick<Db, "query">, agora: Date): Promise<Map<string, number>> {
  const { rows } = await db.query<{ arena_id: string; n: number }>(
    `select arena_id, count(*)::int as n from reservas
      where tipo = 'reserva' and situacao = 'confirmada' and inicio > $1::timestamptz
      group by arena_id`,
    [agora],
  );
  return new Map(rows.map((r) => [r.arena_id, Number(r.n)]));
}

export type EnderecoArena = {
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
};

export type ReservaJogador = {
  id: string;
  // Endereço e coordenadas para o "Como chegar" do cartão.
  arena: { nome: string; slug: string; latitude: number | null; longitude: number | null; endereco: EnderecoArena };
  quadraId: string;
  quadra: string;
  esporte: string;
  fotoId: string | null; // capa da quadra; sem ela, a da arena
  inicio: Date;
  fim: Date;
  totalCentavos: number;
  pagamento: string;
  situacao: string;
  canceladaPor: string | null;
  motivoCancelamento: string | null;
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
    id: string; arena_nome: string; arena_slug: string; latitude: number | null; longitude: number | null;
    rua: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null;
    quadra_id: string; quadra: string; esporte: string; foto_id: string | null; inicio: Date; fim: Date;
    total_centavos: number; pagamento: string; situacao: string; cancelada_por: string | null; lances: number;
    motivo_cancelamento: string | null;
  }>(
    `select r.id, a.nome as arena_nome, a.slug as arena_slug, a.latitude, a.longitude,
            a.endereco_rua as rua, a.endereco_numero as numero, a.endereco_bairro as bairro,
            a.endereco_cidade as cidade, a.endereco_uf as uf, a.endereco_cep as cep,
            q.id as quadra_id, q.nome as quadra, q.esporte, r.inicio, r.fim,
            -- Arena suspensa: a rota /fotos não serve, então nem pede.
            case when a.status_assinatura = 'ativa' then coalesce(
              (select f.id from fotos f where f.quadra_id = q.id and f.arena_id = a.id
                order by f.posicao, f.criado_em, f.id limit 1),
              (select f.id from fotos f where f.quadra_id is null and f.arena_id = a.id
                order by f.posicao, f.criado_em, f.id limit 1)
            ) end as foto_id,
            r.total_centavos, r.pagamento, r.situacao, r.cancelada_por, r.motivo_cancelamento,
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
      arena: {
        nome: r.arena_nome,
        slug: r.arena_slug,
        latitude: r.latitude === null ? null : Number(r.latitude),
        longitude: r.longitude === null ? null : Number(r.longitude),
        endereco: { rua: r.rua, numero: r.numero, bairro: r.bairro, cidade: r.cidade, uf: r.uf, cep: r.cep },
      },
      quadraId: r.quadra_id,
      quadra: r.quadra,
      esporte: r.esporte,
      fotoId: r.foto_id,
      inicio,
      fim: new Date(r.fim),
      totalCentavos: Number(r.total_centavos),
      pagamento: r.pagamento,
      situacao: r.situacao,
      canceladaPor: r.cancelada_por,
      motivoCancelamento: r.motivo_cancelamento,
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
  quadraId: string;
  quadra: string;
  esporte: string;
  inicio: Date;
  fim: Date;
  situacao: string;
  jogador: string | null; // nome, "Conta apagada" ou null (bloqueio)
  totalCentavos: number | null;
  motivo: string | null;
  canceladaPor: string | null;
  motivoCancelamento: string | null;
  futura: boolean; // ainda não começou: o dono pode cancelar
};

// Agenda do dono entre os dias locais `de` e `ate` (inclusive). Do jogador, só o nome.
export async function agendaDaArena(
  db: Db, arenaId: string, agora: Date, intervalo: { de: string; ate: string },
): Promise<ItemAgenda[]> {
  const { de, ate } = intervalo ?? {};
  if (!ehUuid(arenaId) || typeof de !== "string" || typeof ate !== "string" || !DIA.test(de) || !DIA.test(ate)) return [];
  const { rows } = await db.query<LinhaAgenda>(
    `${SELECT_AGENDA}
      where r.arena_id = $1 and r.situacao in ('confirmada', 'cancelada')
        and r.inicio < $3::timestamptz and r.fim > $2::timestamptz
      order by r.inicio, q.nome, r.id`,
    [arenaId, new Date(instanteLocal(de, 0)), new Date(instanteLocal(ate, 24))],
  );
  return rows.map((r) => itemDaAgenda(r, agora));
}

type LinhaAgenda = {
  id: string; tipo: "reserva" | "bloqueio"; quadra_id: string; quadra: string; esporte: string; inicio: Date; fim: Date; situacao: string;
  jogador: string | null; total_centavos: number | null; motivo: string | null; cancelada_por: string | null;
  motivo_cancelamento: string | null;
};

// Colunas da agenda do dono (alias r = reservas, q = quadras, j = jogadores).
const SELECT_AGENDA = `select r.id, r.tipo, r.quadra_id, q.nome as quadra, q.esporte, r.inicio, r.fim, r.situacao,
            case when r.tipo = 'reserva' then coalesce(j.nome, 'Conta apagada') end as jogador,
            r.total_centavos, r.motivo, r.cancelada_por, r.motivo_cancelamento
       from reservas r
       join quadras q on q.id = r.quadra_id and q.arena_id = r.arena_id
       left join jogadores j on j.id = r.jogador_id`;

function itemDaAgenda(r: LinhaAgenda, agora: Date): ItemAgenda {
  return {
    id: r.id,
    tipo: r.tipo,
    quadraId: r.quadra_id,
    quadra: r.quadra,
    esporte: r.esporte ?? "",
    inicio: new Date(r.inicio),
    fim: new Date(r.fim),
    situacao: r.situacao,
    jogador: r.jogador,
    totalCentavos: r.total_centavos === null ? null : Number(r.total_centavos),
    motivo: r.motivo,
    canceladaPor: r.cancelada_por,
    motivoCancelamento: r.motivo_cancelamento,
    futura: new Date(r.inicio).getTime() > agora.getTime(),
  };
}

export const BUSCA_POR_PAGINA = 10;
const BUSCA_MIN = 2;
const BUSCA_MAX = 60;

// Busca do dono pelo nome do jogador, em qualquer dia, mais recentes primeiro.
// Só reservas de jogador desta arena. Termo curto ou longo demais: vazio, sem
// consultar o banco.
export async function buscarNaAgenda(
  db: Pick<Db, "query">, arenaId: string, termo: string, pagina: number, agora: Date, quadraId: string | null = null,
): Promise<{ itens: ItemAgenda[]; total: number }> {
  const vazio = { itens: [], total: 0 };
  if (!ehUuid(arenaId) || typeof termo !== "string" || (quadraId !== null && !ehUuid(quadraId))) return vazio;
  const cru = termo.trim();
  if (cru.length > BUSCA_MAX) return vazio;
  const t = normalizar(cru);
  if (t.length < BUSCA_MIN) return vazio;
  const p = Number.isInteger(pagina) && pagina > 0 ? pagina : 1;
  const filtro = `where r.arena_id = $1 and r.tipo = 'reserva' and r.situacao in ('confirmada', 'cancelada')
        and ($3::uuid is null or r.quadra_id = $3)
        and position($2 in ${sqlNorm("j.nome")}) > 0`;
  const [linhas, conta] = await Promise.all([
    db.query<LinhaAgenda>(
      `${SELECT_AGENDA}
      ${filtro}
      order by r.inicio desc, r.id
      limit ${BUSCA_POR_PAGINA} offset $4`,
      [arenaId, t, quadraId, (p - 1) * BUSCA_POR_PAGINA],
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from reservas r left join jogadores j on j.id = r.jogador_id ${filtro}`,
      [arenaId, t, quadraId],
    ),
  ]);
  return { itens: linhas.rows.map((r) => itemDaAgenda(r, agora)), total: Number(conta.rows[0]?.n ?? 0) };
}

export type ResumoDoMes = { porDia: Map<string, number>; hoje: number; semana: number; aReceberCentavos: number };

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const somaDiasLocal = (dia: string, n: number) => {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

// Números da agenda do dono (só reservas confirmadas de jogador, filtro de quadra opcional):
// - porDia: quantas começam em cada dia do mês;
// - hoje: começam hoje; semana: de hoje até domingo;
// - aReceberCentavos: soma das de hoje em diante dentro do mês.
export async function resumoDoMes(
  db: Pick<Db, "query">, arenaId: string, quadraId: string | null, mes: string, agora: Date,
): Promise<ResumoDoMes> {
  const resumo: ResumoDoMes = { porDia: new Map(), hoje: 0, semana: 0, aReceberCentavos: 0 };
  if (!ehUuid(arenaId) || (quadraId !== null && !ehUuid(quadraId)) || typeof mes !== "string" || !MES.test(mes)) return resumo;
  const hoje = hojeLocal(agora);
  const domingo = somaDiasLocal(hoje, (7 - diaDaSemana(hoje)) % 7);
  const primeiro = `${mes}-01`;
  const ultimo = somaDiasLocal(somaDiasLocal(primeiro, 31).slice(0, 7) + "-01", -1);
  const de = primeiro < hoje ? primeiro : hoje;
  const ate = ultimo > domingo ? ultimo : domingo;
  const { rows } = await db.query<{ inicio: Date; total_centavos: number | null }>(
    `select inicio, total_centavos from reservas
      where arena_id = $1 and tipo = 'reserva' and situacao = 'confirmada'
        and ($2::uuid is null or quadra_id = $2::uuid)
        and inicio >= $3::timestamptz and inicio < $4::timestamptz`,
    [arenaId, quadraId, new Date(instanteLocal(de, 0)), new Date(instanteLocal(ate, 24))],
  );
  for (const r of rows) {
    const dia = hojeLocal(new Date(r.inicio));
    const noMes = dia >= primeiro && dia <= ultimo;
    if (noMes) resumo.porDia.set(dia, (resumo.porDia.get(dia) ?? 0) + 1);
    if (dia === hoje) resumo.hoje++;
    if (dia >= hoje && dia <= domingo) resumo.semana++;
    if (noMes && dia >= hoje) resumo.aReceberCentavos += Number(r.total_centavos ?? 0);
  }
  return resumo;
}

export const BLOQUEIO_MAX_HORARIOS = 48;

// Dono bloqueia um ou mais horários criados da quadra num dia (um bloqueio por
// horário, mesmo motivo). Cada item precisa casar com um horário daquele dia da
// semana e ainda não ter começado; o que não casa, já começou ou esbarra em
// reserva ou bloqueio é pulado (savepoint por item) e entra na contagem.
export async function bloquearHorarios(
  db: Db,
  arenaId: string,
  e: { quadraId: string; dia: string; horarios: { inicio: number; fim: number }[]; motivo: string },
  agora: Date,
): Promise<{ ok: true; bloqueados: number; pulados: number } | { ok: false; erro: string }> {
  if (!ehUuid(arenaId) || !ehUuid(e?.quadraId)) return { ok: false, erro: "Quadra não encontrada." };
  const dia = diaValido(e.dia, agora);
  if (!dia) return { ok: false, erro: "Dia inválido." };
  if (!Array.isArray(e.horarios) || e.horarios.length === 0 || e.horarios.length > BLOQUEIO_MAX_HORARIOS) {
    return { ok: false, erro: "Escolha os horários para bloquear." };
  }
  const motivo = typeof e.motivo === "string" ? e.motivo.trim() : "";
  if (motivo.length < 1 || motivo.length > MOTIVO_BLOQUEIO_MAX) {
    return { ok: false, erro: `Informe o motivo (até ${MOTIVO_BLOQUEIO_MAX} caracteres).` };
  }

  return emTransacao(db, async (tx) => {
    const q = await tx.query("select 1 from quadras where id = $1 and arena_id = $2", [e.quadraId, arenaId]);
    if (q.rows.length === 0) return { ok: false as const, erro: "Quadra não encontrada." };
    const criados = await tx.query<{ inicio: number; fim: number }>(
      "select inicio, fim from horarios_quadra where quadra_id = $1 and arena_id = $2 and dia_semana = $3",
      [e.quadraId, arenaId, diaDaSemana(dia)],
    );
    const existe = new Set(criados.rows.map((h) => `${h.inicio}-${h.fim}`));
    await expirarSeguradas(tx, e.quadraId);
    let bloqueados = 0;
    let pulados = 0;
    for (const h of e.horarios) {
      const de = Number.isInteger(h?.inicio) && Number.isInteger(h?.fim) ? instanteDoMinuto(dia, h.inicio) : Number.NaN;
      if (!existe.has(`${h?.inicio}-${h?.fim}`) || !(de > agora.getTime())) {
        pulados++;
        continue;
      }
      await tx.query("savepoint bloqueio");
      try {
        await tx.query(
          `insert into reservas (arena_id, quadra_id, tipo, situacao, inicio, fim, motivo)
           values ($1, $2, 'bloqueio', 'confirmada', $3, $4, $5)`,
          [arenaId, e.quadraId, new Date(de), new Date(instanteDoMinuto(dia, h.fim)), motivo],
        );
        await tx.query("release savepoint bloqueio");
        bloqueados++;
      } catch (err) {
        if (!violouExclusao(err)) throw err;
        await tx.query("rollback to savepoint bloqueio");
        pulados++;
      }
    }
    return { ok: true as const, bloqueados, pulados };
  });
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

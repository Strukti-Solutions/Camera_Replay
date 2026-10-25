import { expect, test, vi } from "vitest";
import type { Db } from "../app/lib/db";
import { criarContaJogador, apagarContaJogador } from "../app/lib/jogadores";
import {
  LIMITE_RESERVAS_POR_ARENA, LIMITE_RESERVAS_TOTAL, MSG_INDISPONIVEL, agendaDaArena, bloquearHorario, cancelarPeloDono, cancelarPeloJogador,
  criarReserva, removerBloqueio, lancesDaReservaDoJogador, periodosOcupados, reservasDoJogador, reservasFuturasPorArena,
} from "../app/lib/reservas";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarHorariosDeHora, criarQuadra } from "./fixtures";

// Segunda, 09/11/2026, 10h em São Paulo. Reservas em 10/11 (terça).
const AGORA = new Date("2026-11-09T10:00:00-03:00");
const DIA = "2026-11-10";
const SENHA = "senha-boa-1";
const h = (hora: number, dia = DIA) => new Date(`${dia}T${String(hora).padStart(2, "0")}:00:00-03:00`);

async function jogador(db: Db, nome: string): Promise<string> {
  const r = await criarContaJogador(db, { nome, email: `${nome.toLowerCase()}@x.com`, senha: SENHA, aceitouTermos: true });
  if (!r.ok) throw new Error("conta");
  return r.jogadorId;
}

// Arena com quadra de horários de 1 h, 7h–23h todos os dias, R$ 100,00 a hora (R$ 120,00 das 20h).
async function base(db: Db) {
  const arena = await criarArena(db, "Arena A");
  const quadra = await criarQuadra(db, arena.id);
  await criarHorariosDeHora(db, arena.id, quadra.id, [0, 1, 2, 3, 4, 5, 6], 7, 20, 10000);
  await criarHorariosDeHora(db, arena.id, quadra.id, [0, 1, 2, 3, 4, 5, 6], 20, 23, 12000);
  const ana = await jogador(db, "Ana");
  return { arena, quadra, ana };
}

const contar = async (db: Db) => Number((await db.query<{ n: number }>("select count(*)::int as n from reservas")).rows[0].n);

// `hora` é a hora cheia do primeiro horário; `qtd`, quantos horários seguidos.
async function reservar(db: Db, jogadorId: string, quadraId: string, hora: number, qtd: number, agora = AGORA) {
  const r = await criarReserva(db, jogadorId, { quadraId, dia: DIA, inicio: hora * 60, qtd }, agora);
  if (!r.ok) throw new Error(r.erro);
  return r.reservaId;
}

// Reserva passada gravada direto (criarReserva não aceita o passado).
async function reservaPassada(db: Db, arenaId: string, quadraId: string, jogadorId: string, dia: string) {
  const r = await db.query<{ id: string }>(
    `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim, pagamento, total_centavos, taxa_centavos, detalhe)
     values ($1, $2, $3, 'reserva', 'confirmada', $4, $5, 'arena', 10000, 0, '[{"inicio":1080,"fim":1140,"precoCentavos":10000}]') returning id`,
    [arenaId, quadraId, jogadorId, h(18, dia), h(19, dia)],
  );
  return r.rows[0].id;
}

test("cria reserva confirmada com valores congelados", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const r = await criarReserva(db, ana, { quadraId: quadra.id, dia: DIA, inicio: 19 * 60, qtd: 2 }, AGORA);
  expect(r.ok).toBe(true);
  const l = await db.query(
    `select arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim, pagamento, total_centavos, taxa_centavos, detalhe
       from reservas`);
  expect(l.rows).toEqual([{
    arena_id: arena.id, quadra_id: quadra.id, jogador_id: ana, tipo: "reserva", situacao: "confirmada",
    inicio: h(19), fim: h(21), pagamento: "arena", total_centavos: 22000, taxa_centavos: 0,
    detalhe: [{ inicio: 1140, fim: 1200, precoCentavos: 10000 }, { inicio: 1200, fim: 1260, precoCentavos: 12000 }],
  }]);
  // mudar o horário depois não muda a reserva
  await db.query("update horarios_quadra set preco_centavos = 1 where quadra_id = $1", [quadra.id]);
  const d = await db.query<{ total_centavos: number }>("select total_centavos from reservas");
  expect(d.rows[0].total_centavos).toBe(22000);
});

test("recusa qtd demais, início passado, dia fora da janela, quadra sem horários e quadra de arena suspensa", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  await reservar(db, ana, quadra.id, 20, 1);
  const semPreco = await criarQuadra(db, arena.id);
  const suspensa = await criarArena(db, "Suspensa");
  const qs = await criarQuadra(db, suspensa.id);
  await criarHorariosDeHora(db, suspensa.id, qs.id, [2], 7, 23, 10000);
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [suspensa.id]);
  const recusa = { ok: false, erro: MSG_INDISPONIVEL };
  const tentar = (e: { quadraId: string; dia: string; inicio: number; qtd: number }) => criarReserva(db, ana, e, AGORA);

  expect(await tentar({ quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 3 })).toEqual(recusa); // 20h ocupada
  expect(await tentar({ quadraId: quadra.id, dia: DIA, inicio: 8 * 60, qtd: 5 })).toEqual(recusa); // qtd acima de 4
  expect(await tentar({ quadraId: quadra.id, dia: DIA, inicio: 22 * 60, qtd: 2 })).toEqual(recusa); // 23h não é horário
  expect(await tentar({ quadraId: quadra.id, dia: "2026-11-09", inicio: 9 * 60, qtd: 1 })).toEqual(recusa); // já passou
  expect(await tentar({ quadraId: quadra.id, dia: "2026-11-09", inicio: 10 * 60, qtd: 1 })).toEqual(recusa); // hora corrente
  expect(await tentar({ quadraId: quadra.id, dia: "2026-12-20", inicio: 18 * 60, qtd: 1 })).toEqual(recusa); // além de 30 dias
  expect(await tentar({ quadraId: quadra.id, dia: "2026-11-08", inicio: 18 * 60, qtd: 1 })).toEqual(recusa); // ontem
  expect(await tentar({ quadraId: quadra.id, dia: "2026-02-30", inicio: 18 * 60, qtd: 1 })).toEqual(recusa);
  expect(await tentar({ quadraId: quadra.id, dia: DIA, inicio: 18 * 60 + 5, qtd: 1 })).toEqual(recusa);
  expect(await tentar({ quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 0 })).toEqual(recusa);
  expect(await tentar({ quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 1.5 })).toEqual(recusa);
  expect(await tentar({ quadraId: semPreco.id, dia: DIA, inicio: 18 * 60, qtd: 1 })).toEqual(recusa);
  expect(await tentar({ quadraId: qs.id, dia: DIA, inicio: 18 * 60, qtd: 1 })).toEqual(recusa);
  expect(await tentar({ quadraId: "nao-e-uuid", dia: DIA, inicio: 18 * 60, qtd: 1 })).toEqual(recusa);
  expect(await tentar({ quadraId: "00000000-0000-4000-8000-000000000000", dia: DIA, inicio: 18 * 60, qtd: 1 })).toEqual(recusa);
  expect(await contar(db)).toBe(1);
});

test("dois jogadores ao mesmo tempo: um consegue", async () => {
  const db = await novoBanco();
  const { quadra, ana } = await base(db);
  const bia = await jogador(db, "Bia");
  const rs = await Promise.all([
    criarReserva(db, ana, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 2 }, AGORA),
    criarReserva(db, bia, { quadraId: quadra.id, dia: DIA, inicio: 19 * 60, qtd: 1 }, AGORA),
  ]);
  expect(rs.filter((r) => r.ok)).toHaveLength(1);
  expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, erro: MSG_INDISPONIVEL }]);
  expect(await contar(db)).toBe(1);
});

test("reserva ocupa e libera ao cancelar", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const id = await reservar(db, ana, quadra.id, 18, 2);
  expect(await periodosOcupados(db, arena.id, quadra.id, DIA)).toEqual([{ inicio: h(18), fim: h(20) }]);
  expect(await periodosOcupados(db, arena.id, quadra.id, "2026-11-11")).toEqual([]);
  const outra = await criarArena(db, "B");
  expect(await periodosOcupados(db, outra.id, quadra.id, DIA)).toEqual([]);

  const antes = await reservasDoJogador(db, ana, AGORA);
  expect(antes.proximas).toEqual([{
    id, arena: { nome: "Arena A", slug: arena.slug, latitude: null, longitude: null, endereco: SEM_ENDERECO },
    quadraId: quadra.id, quadra: "Quadra 1", esporte: "", inicio: h(18), fim: h(20),
    totalCentavos: 20000, pagamento: "arena", situacao: "confirmada", canceladaPor: null, motivoCancelamento: null, podeCancelar: true, lances: 0,
  }]);
  expect(antes.historico).toEqual([]);

  expect(await cancelarPeloJogador(db, ana, id, AGORA)).toBe(true);
  expect(await periodosOcupados(db, arena.id, quadra.id, DIA)).toEqual([]);
  const depois = await reservasDoJogador(db, ana, AGORA);
  expect(depois.proximas).toEqual([]);
  expect(depois.historico).toMatchObject([{ id, situacao: "cancelada", canceladaPor: "jogador", podeCancelar: false }]);
  const c = await db.query("select cancelada_por, cancelada_em is not null as quando from reservas where id = $1", [id]);
  expect(c.rows[0]).toEqual({ cancelada_por: "jogador", quando: true });
  await reservar(db, ana, quadra.id, 18, 2);
});

const SEM_ENDERECO = { rua: null, numero: null, bairro: null, cidade: null, uf: null, cep: null };

test("reservas do jogador trazem a quadra (id e esporte) e o endereço da arena", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  await db.query(
    `update arenas set endereco_rua = 'Rua A', endereco_numero = '10', endereco_bairro = 'Centro',
            endereco_cidade = 'Fortaleza', endereco_uf = 'CE', endereco_cep = '60000-000',
            latitude = -3.73, longitude = -38.52 where id = $1`, [arena.id]);
  await db.query("update quadras set esporte = 'Padel' where id = $1", [quadra.id]);
  await reservar(db, ana, quadra.id, 18, 1);
  const { proximas } = await reservasDoJogador(db, ana, AGORA);
  expect(proximas[0]).toMatchObject({
    quadraId: quadra.id, esporte: "Padel",
    arena: {
      nome: "Arena A", slug: arena.slug, latitude: -3.73, longitude: -38.52,
      endereco: { rua: "Rua A", numero: "10", bairro: "Centro", cidade: "Fortaleza", uf: "CE", cep: "60000-000" },
    },
  });
});

test("cancelamento do jogador: 24h00 antes aceita, 23h59 recusa, de outro jogador recusa", async () => {
  const db = await novoBanco();
  const { quadra, ana } = await base(db);
  const bia = await jogador(db, "Bia");
  const id = await reservar(db, ana, quadra.id, 18, 1); // 10/11 18h
  const id2 = await reservar(db, ana, quadra.id, 8, 1); // 10/11 8h
  const vespera = (hm: string) => new Date(`2026-11-09T${hm}:00-03:00`);

  expect(await cancelarPeloJogador(db, bia, id, vespera("10:00"))).toBe(false);
  expect(await cancelarPeloJogador(db, ana, id, vespera("18:01"))).toBe(false);
  const lista = await reservasDoJogador(db, ana, vespera("18:01"));
  expect(lista.proximas.find((r) => r.id === id)?.podeCancelar).toBe(false);
  expect(await cancelarPeloJogador(db, ana, id, vespera("18:00"))).toBe(true);
  expect(await cancelarPeloJogador(db, ana, id, vespera("10:00"))).toBe(false); // já cancelada
  expect(await cancelarPeloJogador(db, ana, "nao-e-uuid", vespera("10:00"))).toBe(false);
  expect(await cancelarPeloJogador(db, ana, id2, vespera("07:59"))).toBe(true);
});

test("dono cancela a qualquer momento e o motivo fica", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const outra = await criarArena(db, "B");
  const id = await reservar(db, ana, quadra.id, 18, 1);
  const passada = await reservaPassada(db, arena.id, quadra.id, ana, "2026-10-01");
  const quaseNaHora = new Date("2026-11-10T17:59:00-03:00");

  expect(await cancelarPeloDono(db, outra.id, id, "x", quaseNaHora)).toBe(false);
  expect(await cancelarPeloDono(db, arena.id, id, "x".repeat(121), quaseNaHora)).toBe(false);
  expect(await cancelarPeloDono(db, arena.id, passada, "x")).toBe(false);
  expect(await cancelarPeloDono(db, arena.id, id, "  Chuva forte  ", quaseNaHora)).toBe(true);
  const c = await db.query("select situacao, cancelada_por, motivo_cancelamento from reservas where id = $1", [id]);
  expect(c.rows[0]).toEqual({ situacao: "cancelada", cancelada_por: "dono", motivo_cancelamento: "Chuva forte" });
  expect(await cancelarPeloDono(db, arena.id, id, undefined, quaseNaHora)).toBe(false); // já cancelada

  const sem = await reservar(db, ana, quadra.id, 18, 1);
  expect(await cancelarPeloDono(db, arena.id, sem, "   ", quaseNaHora)).toBe(true);
  const s = await db.query("select motivo_cancelamento from reservas where id = $1", [sem]);
  expect(s.rows[0].motivo_cancelamento).toBeNull();
  const hist = await reservasDoJogador(db, ana, AGORA);
  // histórico: canceladas e passadas, mais recentes primeiro
  expect(hist.historico.map((r) => r.id).slice(0, 2).sort()).toEqual([id, sem].sort());
  expect(hist.historico[2]).toMatchObject({ id: passada, situacao: "confirmada", podeCancelar: false });
  expect(hist.historico.find((r) => r.id === id)).toMatchObject({ canceladaPor: "dono", motivoCancelamento: "Chuva forte" });
  expect(hist.historico.find((r) => r.id === sem)).toMatchObject({ canceladaPor: "dono", motivoCancelamento: null });
});

test("bloqueio: sobre reserva recusa, encostado aceita, sem motivo recusa, de outra arena recusa", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const outra = await criarArena(db, "B");
  await reservar(db, ana, quadra.id, 18, 2);
  const bloq = (e: Partial<{ quadraId: string; dia: string; inicio: number; fim: number; motivo: string }>, arenaId = arena.id) =>
    bloquearHorario(db, arenaId, { quadraId: quadra.id, dia: DIA, inicio: 20, fim: 22, motivo: "Telefone — João", ...e }, AGORA);

  expect(await bloq({ inicio: 19, fim: 21 })).toEqual({ ok: false, erro: "Já existe reserva ou bloqueio nesse horário." });
  expect(await bloq({ motivo: "   " })).toMatchObject({ ok: false });
  expect(await bloq({ motivo: "x".repeat(61) })).toMatchObject({ ok: false });
  expect(await bloq({}, outra.id)).toMatchObject({ ok: false });
  expect(await bloq({ inicio: 22, fim: 21 })).toMatchObject({ ok: false });
  expect(await bloq({ inicio: 0, fim: 13 })).toMatchObject({ ok: false }); // mais de 12 h
  expect(await bloq({ dia: "2026-11-09", inicio: 9, fim: 11 })).toMatchObject({ ok: false }); // já começou
  expect(await bloq({ dia: "2026-12-20" })).toMatchObject({ ok: false });
  expect(await contar(db)).toBe(1);

  expect(await bloq({ motivo: "  Telefone — João " })).toEqual({ ok: true }); // encostado em 20h
  expect(await bloq({ inicio: 23, fim: 24, motivo: "Manutenção" })).toEqual({ ok: true }); // fora da tabela pode
  const b = await db.query("select tipo, situacao, jogador_id, motivo, inicio, fim, total_centavos from reservas where tipo = 'bloqueio' order by inicio");
  expect(b.rows[0]).toEqual({ tipo: "bloqueio", situacao: "confirmada", jogador_id: null, motivo: "Telefone — João", inicio: h(20), fim: h(22), total_centavos: null });
  expect(b.rows[1].fim).toEqual(new Date("2026-11-11T00:00:00-03:00"));

  // reserva sobre bloqueio recusa; dono remove o bloqueio e o horário volta
  expect(await criarReserva(db, ana, { quadraId: quadra.id, dia: DIA, inicio: 21 * 60, qtd: 1 }, AGORA))
    .toEqual({ ok: false, erro: MSG_INDISPONIVEL });
  const id = (await db.query<{ id: string }>("select id from reservas where tipo = 'bloqueio' and inicio = $1", [h(20)])).rows[0].id;
  expect(await cancelarPeloDono(db, outra.id, id, undefined, AGORA)).toBe(false);
  expect(await cancelarPeloDono(db, arena.id, id, undefined, AGORA)).toBe(true);
  const s = await db.query("select situacao, cancelada_por from reservas where id = $1", [id]);
  expect(s.rows[0]).toEqual({ situacao: "cancelada", cancelada_por: "dono" });
  expect((await criarReserva(db, ana, { quadraId: quadra.id, dia: DIA, inicio: 21 * 60, qtd: 1 }, AGORA)).ok).toBe(true);
});

test("segurada vencida não ocupa e vira expirada", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const segurar = (i: number, f: number, prazo: string) => db.query<{ id: string }>(
    `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim, segura_ate, pagamento, total_centavos, taxa_centavos, detalhe)
     values ($1, $2, $3, 'reserva', 'segurada', $4, $5, now() + $6::interval, 'online', 10000, 0, '[]') returning id`,
    [arena.id, quadra.id, ana, h(i), h(f), prazo]);
  const vencida = (await segurar(18, 19, "-1 minute")).rows[0].id;
  await segurar(20, 21, "10 minutes");

  expect(await periodosOcupados(db, arena.id, quadra.id, DIA)).toEqual([{ inicio: h(20), fim: h(21) }]);
  expect(await criarReserva(db, ana, { quadraId: quadra.id, dia: DIA, inicio: 20 * 60, qtd: 1 }, AGORA))
    .toEqual({ ok: false, erro: MSG_INDISPONIVEL });
  expect((await criarReserva(db, ana, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 1 }, AGORA)).ok).toBe(true);
  const v = await db.query("select situacao from reservas where id = $1", [vencida]);
  expect(v.rows[0].situacao).toBe("expirada");

  // o bloqueio também expira as vencidas antes de gravar
  const v2 = (await segurar(8, 9, "-1 minute")).rows[0].id;
  expect(await bloquearHorario(db, arena.id, { quadraId: quadra.id, dia: DIA, inicio: 8, fim: 9, motivo: "Aula" }, AGORA))
    .toEqual({ ok: true });
  expect((await db.query("select situacao from reservas where id = $1", [v2])).rows[0].situacao).toBe("expirada");
});

test("agenda mostra nome do jogador ou Conta apagada", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const outra = await criarArena(db, "B");
  const bia = await jogador(db, "Bia");
  const ra = await reservar(db, ana, quadra.id, 18, 2);
  await bloquearHorario(db, arena.id, { quadraId: quadra.id, dia: DIA, inicio: 8, fim: 10, motivo: "Aula" }, AGORA);
  const rb = await reservaPassada(db, arena.id, quadra.id, bia, "2026-10-01"); // passada de verdade (apagar usa now())
  expect(await apagarContaJogador(db, bia, SENHA)).toEqual({ ok: true });
  const fora = await db.query<{ id: string }>(
    `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim, pagamento, total_centavos, taxa_centavos, detalhe)
     values ($1, $2, $3, 'reserva', 'confirmada', $4, $5, 'arena', 1, 0, '[]') returning id`,
    [arena.id, quadra.id, ana, h(18, "2026-11-20"), h(19, "2026-11-20")]);

  const ag = await agendaDaArena(db, arena.id, AGORA, { de: "2026-10-01", ate: DIA });
  expect(ag.map((i) => [i.id === rb ? "rb" : i.id === ra ? "ra" : i.tipo, i.jogador])).toEqual([
    ["rb", "Conta apagada"], ["bloqueio", null], ["ra", "Ana"],
  ]);
  expect(ag.find((i) => i.id === ra)).toMatchObject({
    tipo: "reserva", quadraId: quadra.id, quadra: "Quadra 1", esporte: expect.any(String), inicio: h(18), fim: h(20), situacao: "confirmada",
    totalCentavos: 20000, motivo: null, canceladaPor: null, motivoCancelamento: null,
  });
  expect(ag.find((i) => i.tipo === "bloqueio")).toMatchObject({ motivo: "Aula", totalCentavos: null });
  expect(ag.some((i) => i.id === fora.rows[0].id)).toBe(false);
  expect(await agendaDaArena(db, outra.id, AGORA, { de: "2026-10-01", ate: DIA })).toEqual([]);
  expect(await agendaDaArena(db, arena.id, AGORA, { de: "lixo", ate: DIA })).toEqual([]);
});

test("lances só do dono da reserva e só na janela", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const bia = await jogador(db, "Bia");
  const camera = await criarCamera(db, arena.id, quadra.id);
  const botao = await criarBotao(db, arena.id, quadra.id, camera.id);
  const outraQ = await criarQuadra(db, arena.id);
  const camOutra = await criarCamera(db, arena.id, outraQ.id);
  const botOutra = await criarBotao(db, arena.id, outraQ.id, camOutra.id);
  const clipe = async (quando: Date, o: { status?: string; cam?: string; bot?: string; expira?: string } = {}) => {
    const a = await db.query<{ id: string }>(
      "insert into apertos (arena_id, botao_id, recebido_em) values ($1, $2, $3) returning id",
      [arena.id, o.bot ?? botao.id, quando]);
    const c = await db.query<{ id: string }>(
      `insert into clipes (arena_id, aperto_id, camera_id, status, duracao, recebido_em, expira_em)
       values ($1, $2, $3, $4, 30, $5, now() + $6::interval) returning id`,
      [arena.id, a.rows[0].id, o.cam ?? camera.id, o.status ?? "pronto", quando, o.expira ?? "1 day"]);
    await db.query("update clipes set chave_r2 = $2 where id = $1", [c.rows[0].id, `clipes/${arena.id}/${c.rows[0].id}.mp4`]);
    return c.rows[0].id;
  };
  const id = await reservar(db, ana, quadra.id, 18, 2);
  const noInicio = await clipe(h(18));
  const parcial = await clipe(new Date("2026-11-10T19:59:59-03:00"), { status: "parcial" });
  await clipe(new Date("2026-11-10T17:59:59-03:00"));
  await clipe(h(20));
  await clipe(new Date("2026-11-10T18:30:00-03:00"), { status: "falhou" });
  await clipe(new Date("2026-11-10T18:31:00-03:00"), { expira: "-1 minute" });
  await clipe(new Date("2026-11-10T18:32:00-03:00"), { cam: camOutra.id, bot: botOutra.id });

  const r2 = { urlLeitura: vi.fn(async (chave: string) => `https://r2/${chave}`) };
  const lances = await lancesDaReservaDoJogador(db, r2, ana, id);
  expect(lances?.map((c) => c.id).sort()).toEqual([noInicio, parcial].sort());
  expect(lances?.[0].url).toMatch(/^https:\/\/r2\/clipes\//);
  expect(await lancesDaReservaDoJogador(db, r2, bia, id)).toBeNull();
  expect(await lancesDaReservaDoJogador(db, r2, ana, "nao-e-uuid")).toBeNull();
  expect((await reservasDoJogador(db, ana, AGORA)).proximas[0].lances).toBe(2);

  expect(await cancelarPeloJogador(db, ana, id, AGORA)).toBe(true);
  expect(await lancesDaReservaDoJogador(db, r2, ana, id)).toBeNull();
  expect((await reservasDoJogador(db, ana, AGORA)).historico[0].lances).toBe(0);
});

test("apagar conta com reserva futura recusa; sem futura apaga e mantém as passadas sem jogador", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const passada = await reservaPassada(db, arena.id, quadra.id, ana, "2026-10-01");
  const futura = await reservar(db, ana, quadra.id, 18, 1);

  expect(await apagarContaJogador(db, ana, "errada-errada")).toEqual({ ok: false, erro: "senha" });
  expect(await apagarContaJogador(db, ana, SENHA)).toEqual({ ok: false, erro: "reservas_futuras" });
  expect((await db.query("select 1 from jogadores where id = $1", [ana])).rows).toHaveLength(1);

  expect(await cancelarPeloJogador(db, ana, futura, AGORA)).toBe(true);
  expect(await apagarContaJogador(db, ana, SENHA)).toEqual({ ok: true });
  const r = await db.query<{ id: string; jogador_id: string | null }>("select id, jogador_id from reservas order by inicio");
  expect(r.rows).toEqual([{ id: passada, jogador_id: null }, { id: futura, jogador_id: null }]);
});

const MSG_LIMITE = "Você atingiu o limite de reservas futuras. Cancele uma ou aguarde o jogo.";

test("limite de reservas futuras: 2 por arena e 5 no total; cancelada e passada não contam", async () => {
  expect(LIMITE_RESERVAS_POR_ARENA).toBe(2);
  expect(LIMITE_RESERVAS_TOTAL).toBe(5);
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  await reservaPassada(db, arena.id, quadra.id, ana, "2026-10-01");
  await reservaPassada(db, arena.id, quadra.id, ana, "2026-10-02");
  const cancelada = await reservar(db, ana, quadra.id, 18, 1);
  expect(await cancelarPeloJogador(db, ana, cancelada, AGORA)).toBe(true);
  await reservar(db, ana, quadra.id, 19, 1);
  await reservar(db, ana, quadra.id, 20, 1);
  // a 3ª futura na mesma arena (outra quadra) é recusada, nada gravado
  const q2 = await criarQuadra(db, arena.id);
  await criarHorariosDeHora(db, arena.id, q2.id, [2], 7, 23, 100);
  const antes = await contar(db);
  expect(await criarReserva(db, ana, { quadraId: q2.id, dia: DIA, inicio: 11 * 60, qtd: 1 }, AGORA))
    .toEqual({ ok: false, erro: MSG_LIMITE });
  expect(await contar(db)).toBe(antes);
  // outro jogador não é afetado
  const bia = await jogador(db, "Bia");
  expect((await criarReserva(db, bia, { quadraId: q2.id, dia: DIA, inicio: 11 * 60, qtd: 1 }, AGORA)).ok).toBe(true);

  // espalhadas por arenas: 2 + 2 + 1 = 5; a 6ª é recusada
  const outras = [];
  for (const nome of ["B", "C", "D"]) {
    const a = await criarArena(db, nome);
    const q = await criarQuadra(db, a.id);
    await criarHorariosDeHora(db, a.id, q.id, [2], 7, 23, 100);
    outras.push(q);
  }
  await reservar(db, ana, outras[0].id, 8, 1);
  await reservar(db, ana, outras[0].id, 9, 1);
  await reservar(db, ana, outras[1].id, 8, 1);
  expect(await criarReserva(db, ana, { quadraId: outras[2].id, dia: DIA, inicio: 8 * 60, qtd: 1 }, AGORA))
    .toEqual({ ok: false, erro: MSG_LIMITE });
  // depois do jogo, a reserva deixa de contar
  const depois = new Date("2026-11-10T21:00:00-03:00");
  expect((await criarReserva(db, ana, { quadraId: outras[2].id, dia: DIA, inicio: 22 * 60, qtd: 1 }, depois)).ok).toBe(true);
});

test("jogador inexistente não reserva", async () => {
  const db = await novoBanco();
  const { quadra } = await base(db);
  expect(await criarReserva(db, "00000000-0000-4000-8000-000000000009", { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 1 }, AGORA))
    .toEqual({ ok: false, erro: MSG_INDISPONIVEL });
  expect(await contar(db)).toBe(0);
});

test("agenda devolve o motivo do cancelamento", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const id = await reservar(db, ana, quadra.id, 18, 1);
  expect(await cancelarPeloDono(db, arena.id, id, "Chuva forte", AGORA)).toBe(true);
  const ag = await agendaDaArena(db, arena.id, AGORA, { de: DIA, ate: DIA });
  expect(ag.find((i) => i.id === id)).toMatchObject({ situacao: "cancelada", canceladaPor: "dono", motivoCancelamento: "Chuva forte" });
});

test("removerBloqueio só remove bloqueio futuro da própria arena", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const outra = await criarArena(db, "B");
  const reserva = await reservar(db, ana, quadra.id, 18, 1);
  await bloquearHorario(db, arena.id, { quadraId: quadra.id, dia: DIA, inicio: 8, fim: 10, motivo: "Aula" }, AGORA);
  const bloqueio = (await db.query<{ id: string }>("select id from reservas where tipo = 'bloqueio'")).rows[0].id;
  expect(await removerBloqueio(db, arena.id, reserva, AGORA)).toBe(false); // reserva de jogador: recusa
  expect(await removerBloqueio(db, outra.id, bloqueio, AGORA)).toBe(false);
  expect(await removerBloqueio(db, arena.id, bloqueio, h(9))).toBe(false); // já começou
  expect(await removerBloqueio(db, arena.id, "lixo", AGORA)).toBe(false);
  expect(await removerBloqueio(db, arena.id, bloqueio, AGORA)).toBe(true);
  const s = await db.query("select id, situacao, cancelada_por from reservas order by tipo");
  expect(s.rows).toEqual([
    { id: bloqueio, situacao: "cancelada", cancelada_por: "dono" },
    { id: reserva, situacao: "confirmada", cancelada_por: null },
  ]);
});

test("reservas futuras confirmadas por arena: ignora bloqueio, cancelada, passada e outra arena", async () => {
  const db = await novoBanco();
  const { arena, quadra, ana } = await base(db);
  const bia = await jogador(db, "Bia");
  await reservar(db, ana, quadra.id, 8, 1);
  await reservar(db, bia, quadra.id, 10, 2);
  const cancelada = await reservar(db, ana, quadra.id, 14, 1);
  expect(await cancelarPeloJogador(db, ana, cancelada, new Date("2026-11-01T10:00:00-03:00"))).toBe(true);
  await reservaPassada(db, arena.id, quadra.id, ana, "2026-11-01");
  expect(await bloquearHorario(db, arena.id, { quadraId: quadra.id, dia: DIA, inicio: 16, fim: 18, motivo: "Manutenção" }, AGORA))
    .toEqual({ ok: true });
  const outra = await criarArena(db, "Arena B");
  const qb = await criarQuadra(db, outra.id);
  await criarHorariosDeHora(db, outra.id, qb.id, [2], 7, 23, 10000);
  await reservar(db, bia, qb.id, 18, 1);
  const vazia = await criarArena(db, "Arena C");

  const n = await reservasFuturasPorArena(db, AGORA);
  expect(n.get(arena.id)).toBe(2);
  expect(n.get(outra.id)).toBe(1);
  expect(n.get(vazia.id) ?? 0).toBe(0);
  // Já começou às 8h do dia 10: deixa de ser futura.
  expect((await reservasFuturasPorArena(db, h(9))).get(arena.id)).toBe(1);
});

// Corrida real com a exclusão da 0016: outra reserva confirmada entra depois da
// conferência de horários livres e antes da transação; o insert esbarra (23P01)
// e o jogador recebe "não está mais disponível", sem linha a mais.
test("exclusão (23P01) depois da conferência vira MSG_INDISPONIVEL e não grava", async () => {
  const pg = await novoBanco();
  const { arena, quadra, ana } = await base(pg);
  const bia = await jogador(pg, "Bia");
  let intrusa = false;
  const db: Db = {
    query: (sql, params) => pg.query(sql, params),
    async transaction(fn) {
      await pg.query(
        `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim, pagamento, total_centavos, taxa_centavos, detalhe)
         values ($1, $2, $3, 'reserva', 'confirmada', $4, $5, 'arena', 10000, 0, '[]')`,
        [arena.id, quadra.id, bia, h(19), h(20)],
      );
      intrusa = true;
      return pg.transaction!(fn);
    },
  };
  expect(await criarReserva(db, ana, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 2 }, AGORA))
    .toEqual({ ok: false, erro: MSG_INDISPONIVEL });
  expect(intrusa).toBe(true);
  const l = await pg.query<{ jogador_id: string }>("select jogador_id from reservas");
  expect(l.rows).toEqual([{ jogador_id: bia }]);
});

// Pool falso: no pg.Pool, criarReserva trava o jogador (for no key update) e
// só depois, em comando separado do mesmo cliente, conta as reservas e insere.
test("no pg.Pool, criar reserva trava o jogador antes de contar e inserir", async () => {
  const pg = await novoBanco();
  const { quadra, ana } = await base(pg);
  const log: string[] = [];
  const clientes: unknown[] = [];
  const db = {
    // Conferências antes da transação vão ao banco de verdade.
    query: (sql: string, params?: unknown[]) => pg.query(sql, params),
    async connect() {
      const cliente = {
        async query(sql: string) {
          const s = sql.trim();
          if (/^begin|^commit|^rollback/.test(s)) log.push(s);
          else if (/from jogadores/.test(s) && /for no key update/.test(s)) log.push("trava");
          else if (/^select/.test(s) && /from reservas/.test(s)) log.push("conta");
          else if (/^update reservas set situacao = 'expirada'/.test(s)) log.push("expira");
          else if (/^insert into reservas/.test(s)) log.push("insere");
          else log.push("?" + s);
          if (/for no key update/.test(s)) return { rows: [{ "?column?": 1 }] };
          if (/^select/.test(s) && /from reservas/.test(s)) return { rows: [{ arena: 0, total: 0 }] };
          if (/^insert into reservas/.test(s)) return { rows: [{ id: "r1" }] };
          return { rows: [] };
        },
        release() { clientes.push(cliente); },
      };
      return cliente;
    },
  } as unknown as Db;

  expect(await criarReserva(db, ana, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 1 }, AGORA))
    .toEqual({ ok: true, reservaId: "r1" });
  expect(log).toEqual(["begin", "trava", "conta", "expira", "insere", "commit"]);
  expect(clientes).toHaveLength(1);
  expect(await contar(pg)).toBe(0);
});

test("reserva de 2 horários quebrados grava o período todo e os itens", async () => {
  const db = await novoBanco();
  const { arena, ana } = await base(db);
  const q = await criarQuadra(db, arena.id);
  const horarios = [[930, 1035, 11000], [1035, 1080, 6000], [1080, 1140, 9000]];
  await db.query(
    `insert into horarios_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos)
     select $1, $2, 2, i, f, p from unnest($3::int[], $4::int[], $5::int[]) as t(i, f, p)`,
    [arena.id, q.id, horarios.map((x) => x[0]), horarios.map((x) => x[1]), horarios.map((x) => x[2])],
  );
  const r = await criarReserva(db, ana, { quadraId: q.id, dia: DIA, inicio: 930, qtd: 2 }, AGORA);
  expect(r.ok).toBe(true);
  const l = await db.query("select inicio, fim, total_centavos, detalhe from reservas");
  expect(l.rows).toEqual([{
    inicio: new Date(`${DIA}T15:30:00-03:00`), fim: new Date(`${DIA}T18:00:00-03:00`), total_centavos: 17000,
    detalhe: [{ inicio: 930, fim: 1035, precoCentavos: 11000 }, { inicio: 1035, fim: 1080, precoCentavos: 6000 }],
  }]);
  expect(await criarReserva(db, ana, { quadraId: q.id, dia: DIA, inicio: 1035, qtd: 1 }, AGORA)).toEqual({ ok: false, erro: MSG_INDISPONIVEL });
  expect((await criarReserva(db, ana, { quadraId: q.id, dia: DIA, inicio: 1080, qtd: 1 }, AGORA)).ok).toBe(true);
  // qtd acima de 4 com outro jogador, para não misturar com o limite de reservas de Ana
  const bia = await jogador(db, "Bia");
  expect(await criarReserva(db, bia, { quadraId: q.id, dia: DIA, inicio: 930, qtd: 5 }, AGORA)).toEqual({ ok: false, erro: MSG_INDISPONIVEL });
});

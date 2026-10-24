import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { gerarFixos } from "../app/lib/horarios";
import {
  apagarHorario, copiarDia, criarHorario, criarHorarios, editarHorario, listarHorarios, reservasFuturasPorHorario,
} from "../app/lib/horarios-quadra";
import { criarContaJogador } from "../app/lib/jogadores";
import { novoBanco } from "./db";
import { criarArena, criarQuadra } from "./fixtures";

async function base(db: Db) {
  const a = await criarArena(db, "A");
  const b = await criarArena(db, "B");
  const qa = await criarQuadra(db, a.id);
  const qb = await criarQuadra(db, b.id);
  return { a, b, qa, qb };
}

const contar = async (db: Db, quadraId: string) =>
  Number((await db.query<{ n: number }>("select count(*)::int as n from horarios_quadra where quadra_id = $1", [quadraId])).rows[0].n);

const h = (diaSemana: number, inicio: number, fim: number, precoCentavos = 8000) => ({ diaSemana, inicio, fim, precoCentavos });
const semId = async (db: Db, a: string, q: string) =>
  (await listarHorarios(db, a, q)).map(({ id: _id, ...x }) => x);

test("cria e lista por dia e início", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  for (const x of [h(3, 840, 900), h(3, 360, 420), h(0, 600, 660)]) {
    const r = await criarHorario(db, a.id, qa.id, x);
    expect(r.ok).toBe(true);
  }
  const l = await listarHorarios(db, a.id, qa.id);
  expect(l.map((x) => [x.diaSemana, x.inicio])).toEqual([[0, 600], [3, 360], [3, 840]]);
  expect(typeof l[0].id).toBe("string");
});

test("choque devolve o intervalo existente; encostar é aceito", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  await criarHorario(db, a.id, qa.id, h(1, 930, 1035));
  expect(await criarHorario(db, a.id, qa.id, h(1, 1000, 1100))).toEqual({ ok: false, erro: "Esse horário choca com 15h30 – 17h15." });
  expect((await criarHorario(db, a.id, qa.id, h(1, 1035, 1100))).ok).toBe(true);
  expect((await criarHorario(db, a.id, qa.id, h(2, 1000, 1100))).ok).toBe(true);
  expect(await criarHorario(db, a.id, qa.id, h(1, 0, 10))).toEqual({ ok: false, erro: "Cada horário dura de 15 minutos a 12 horas." });
});

test("quadra de outra arena ou id inválido", async () => {
  const db = await novoBanco();
  const { a, qb } = await base(db);
  expect(await criarHorario(db, a.id, qb.id, h(1, 420, 480))).toEqual({ ok: false, erro: "Quadra não encontrada." });
  expect(await criarHorario(db, a.id, "nao-uuid", h(1, 420, 480))).toEqual({ ok: false, erro: "Quadra não encontrada." });
  expect(await criarHorarios(db, a.id, qb.id, [h(1, 420, 480)])).toEqual({ ok: false, erro: "Quadra não encontrada." });
  expect(await copiarDia(db, a.id, qb.id, 1, [2])).toEqual({ ok: false, erro: "Quadra não encontrada." });
  expect(await listarHorarios(db, a.id, qb.id)).toEqual([]);
  expect(await contar(db, qb.id)).toBe(0);
});

test("lote pula os que chocam e grava o resto", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  await criarHorario(db, a.id, qa.id, h(1, 930, 1035));
  const lote = gerarFixos({ diaSemana: 1, das: 420, ate: 1320, duracao: 60, precoCentavos: 9000 });
  expect(lote).toHaveLength(15);
  expect(await criarHorarios(db, a.id, qa.id, lote)).toEqual({ ok: true, criados: 12, pulados: 3 });
  expect(await contar(db, qa.id)).toBe(13);
});

test("lote com um inválido não grava nada; vazio e grande demais", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  const r = await criarHorarios(db, a.id, qa.id, [h(1, 420, 480), h(1, 600, 605)]);
  expect(r.ok).toBe(false);
  expect(await contar(db, qa.id)).toBe(0);
  expect(await criarHorarios(db, a.id, qa.id, [])).toEqual({ ok: false, erro: "Nenhum horário para criar." });
  const muitos = Array.from({ length: 673 }, () => h(1, 420, 480));
  expect(await criarHorarios(db, a.id, qa.id, muitos)).toEqual({ ok: false, erro: "Horários demais de uma vez." });
});

test("editar muda hora e preço, recusa choque e aceita encostar no antigo", async () => {
  const db = await novoBanco();
  const { a, b, qa, qb } = await base(db);
  await criarHorario(db, a.id, qa.id, h(1, 420, 480));
  await criarHorario(db, a.id, qa.id, h(1, 540, 600));
  const [p, s] = await listarHorarios(db, a.id, qa.id);
  expect(await editarHorario(db, a.id, p.id, { inicio: 420, fim: 520, precoCentavos: 9500 })).toEqual({ ok: true });
  expect(await semId(db, a.id, qa.id)).toEqual([h(1, 420, 520, 9500), h(1, 540, 600)]);
  expect(await editarHorario(db, a.id, p.id, { inicio: 420, fim: 541, precoCentavos: 9500 })).toEqual({
    ok: false, erro: "Esse horário choca com 9h – 10h.",
  });
  expect((await editarHorario(db, a.id, s.id, { inicio: 520, fim: 600, precoCentavos: 100 })).ok).toBe(true);
  expect(await editarHorario(db, a.id, p.id, { inicio: 10, fim: 12, precoCentavos: 100 })).toEqual({
    ok: false, erro: "Cada horário dura de 15 minutos a 12 horas.",
  });
  expect(await editarHorario(db, a.id, "nao-uuid", { inicio: 420, fim: 480, precoCentavos: 100 })).toEqual({ ok: false, erro: "Horário não encontrado." });
  // outra arena
  await criarHorario(db, b.id, qb.id, h(1, 420, 480));
  const [hb] = await listarHorarios(db, b.id, qb.id);
  expect(await editarHorario(db, a.id, hb.id, { inicio: 430, fim: 490, precoCentavos: 1 })).toEqual({ ok: false, erro: "Horário não encontrado." });
  expect(await apagarHorario(db, a.id, hb.id)).toBe(false);
  expect(await apagarHorario(db, a.id, "nao-uuid")).toBe(false);
  expect(await contar(db, qb.id)).toBe(1);
  expect(await apagarHorario(db, a.id, p.id)).toBe(true);
  expect(await contar(db, qa.id)).toBe(1);
});

test("copiar dia: ignora a própria origem e avisa quando não há o que copiar", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  await criarHorario(db, a.id, qa.id, h(1, 420, 480));
  await criarHorario(db, a.id, qa.id, h(1, 480, 540));
  expect(await copiarDia(db, a.id, qa.id, 1, [2, 3, 1])).toEqual({ ok: true, criados: 4, pulados: 0 });
  expect(await copiarDia(db, a.id, qa.id, 1, [1])).toEqual({ ok: false, erro: "Marque pelo menos um dia." });
  expect(await copiarDia(db, a.id, qa.id, 1, [])).toEqual({ ok: false, erro: "Marque pelo menos um dia." });
  expect(await copiarDia(db, a.id, qa.id, 6, [5])).toEqual({ ok: false, erro: "Esse dia não tem horários para copiar." });
  expect((await listarHorarios(db, a.id, qa.id)).filter((x) => x.diaSemana === 1)).toHaveLength(2);
});

test("copiar segunda para terça vazia e quarta com um que choca", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  await criarHorario(db, a.id, qa.id, h(1, 420, 480));
  await criarHorario(db, a.id, qa.id, h(1, 480, 540));
  await criarHorario(db, a.id, qa.id, h(3, 400, 450));
  expect(await copiarDia(db, a.id, qa.id, 1, [2, 3])).toEqual({ ok: true, criados: 3, pulados: 1 });
});

test("duas criações sobrepostas ao mesmo tempo: só uma ok", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  const rs = await Promise.all([
    criarHorario(db, a.id, qa.id, h(1, 420, 540)),
    criarHorario(db, a.id, qa.id, h(1, 480, 600)),
  ]);
  expect(rs.filter((r) => r.ok)).toHaveLength(1);
  expect(await contar(db, qa.id)).toBe(1);
});

test("reservasFuturasPorHorario conta só reserva confirmada futura que toca o horário", async () => {
  const db = await novoBanco();
  const { a, qa } = await base(db);
  const r = await criarContaJogador(db, { nome: "Ana", email: "ana@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!r.ok) throw new Error("conta");
  await criarHorario(db, a.id, qa.id, h(1, 1080, 1140));
  await criarHorario(db, a.id, qa.id, h(1, 1140, 1200));
  await criarHorario(db, a.id, qa.id, h(2, 1080, 1140));
  const [h18] = await listarHorarios(db, a.id, qa.id);
  const agora = new Date("2026-10-24T10:00:00-03:00"); // sábado
  const ins = (situacao: string, ini: string, fim: string) => db.query(
    `insert into reservas (arena_id, quadra_id, jogador_id, tipo, situacao, inicio, fim, total_centavos, detalhe)
     values ($1, $2, $3, 'reserva', $4, $5, $6, 8000, '[]')`,
    [a.id, qa.id, r.jogadorId, situacao, ini, fim]);
  await ins("confirmada", "2026-10-26T18:00:00-03:00", "2026-10-26T19:00:00-03:00"); // segunda 18h, futura
  await ins("cancelada", "2026-11-02T18:00:00-03:00", "2026-11-02T19:00:00-03:00"); // cancelada
  await ins("confirmada", "2026-10-19T18:00:00-03:00", "2026-10-19T19:00:00-03:00"); // passada
  expect(await reservasFuturasPorHorario(db, a.id, qa.id, agora)).toEqual({ [h18.id]: 1 });
});

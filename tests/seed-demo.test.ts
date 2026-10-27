import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { SLUG_VALIDO } from "../app/lib/clipes";
import { arenaPublica, arenasNoMapa, cartoesDeArenas, esportesDasArenas } from "../app/lib/arenas-publicas";
import { hojeLocal, horariosDoDia } from "../app/lib/disponibilidade";
import { entrarUnico } from "../app/lib/entrar-unico";
import { criarArenaComDono } from "../app/lib/donos";
import { listarHorarios } from "../app/lib/horarios-quadra";
import {
  LIMITE_RESERVAS_POR_ARENA, agendaDaArena, criarReserva, periodosOcupados, reservasDoJogador, resumoDoMes,
} from "../app/lib/reservas";
import {
  arenasForaDaDemo, comSegredosNoEnv, podeSemear, semearDemo, urlLocal, type SegredosDemo,
} from "../db/seed-demo";
import { novoBanco } from "./db";

// Segunda, 09/11/2026, 10h em São Paulo.
const AGORA = new Date("2026-11-09T10:00:00-03:00");
const HORA = 3_600_000;
const EMAIL_JOGADOR = "jogador@exemplo.invalid";

const contar = async (db: Db, tabela: string) =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from ${tabela}`)).rows[0].n);

const TABELAS = [
  "arenas", "quadras", "horarios_quadra", "cameras", "botoes", "usuarios", "jogadores", "reservas", "clipes",
];
const contagens = async (db: Db) =>
  Object.fromEntries(await Promise.all(TABELAS.map(async (t) => [t, await contar(db, t)] as const)));

const idDaArena = async (db: Db, slug: string) =>
  (await db.query<{ id: string }>("select id from arenas where slug = $1", [slug])).rows[0].id;

const quadrasDa = async (db: Db, arenaId: string) =>
  (await db.query<{ id: string; nome: string }>(
    "select id, nome from quadras where arena_id = $1 order by nome", [arenaId])).rows;

// Horários do dia que já têm reserva ou bloqueio, como a página da arena e a busca calculam.
async function ocupadosNoDia(db: Db, arenaId: string, quadraId: string, dia: string, agora: Date) {
  const hs = await listarHorarios(db, arenaId, quadraId);
  const doDia = horariosDoDia(hs, dia, agora, await periodosOcupados(db, arenaId, quadraId, dia));
  return { total: doDia.length, ocupados: doDia.filter((x) => !x.livre).length };
}

test("urlLocal aceita só banco em localhost, 127.0.0.1 ou ::1", () => {
  expect(urlLocal("postgres://u@localhost:5432/x")).toBe(true);
  expect(urlLocal("postgresql://u:p@127.0.0.1/x")).toBe(true);
  expect(urlLocal("postgres://u@[::1]:5432/x")).toBe(true);
  expect(urlLocal("postgres://u@LOCALHOST/x")).toBe(true);
  expect(urlLocal("postgres://u@db.xyz.supabase.co:5432/x")).toBe(false);
  expect(urlLocal("postgres://u@localhost.exemplo.com/x")).toBe(false);
  // O pg troca o host da URL pelo ?host=.
  expect(urlLocal("postgres://u@localhost/x?host=db.xyz.supabase.co")).toBe(false);
  expect(urlLocal("postgres://u@localhost/x?host=localhost&host=evil.com")).toBe(false);
  expect(urlLocal("postgres://u@localhost/x?host=")).toBe(false);
  // "localhost" no usuário ou na senha não conta; o host é o que vem depois do @.
  expect(urlLocal("postgres://localhost:p@evil.com/x")).toBe(false);
  expect(urlLocal("postgres://u@127.0.0.1.nip.io/x")).toBe(false);
  expect(urlLocal("postgres://u@localhost%2Eevil.com/x")).toBe(false);
  expect(urlLocal("postgres://u@[0:0:0:0:0:0:0:1]:5432/x")).toBe(true);
  expect(urlLocal("postgres:///x")).toBe(false);
  expect(urlLocal("/var/run/postgresql x")).toBe(false);
  expect(urlLocal("http://localhost/x")).toBe(false);
  expect(urlLocal("isso não é url")).toBe(false);
});

test("arenasForaDaDemo ignora as arenas de demonstração (pelos slugs fixos) e conta qualquer outra", async () => {
  const db = await novoBanco();
  expect(await arenasForaDaDemo(db)).toBe(0);
  await semearDemo(db, { agora: AGORA });
  expect(await contar(db, "arenas")).toBe(3);
  expect(await arenasForaDaDemo(db)).toBe(0);
  await criarArenaComDono(db, { arena: "Arena de Verdade", email: "dono@verdade.com", senha: "senha-bem-longa" });
  expect(await arenasForaDaDemo(db)).toBe(1);
  // Terminar em "-demonstracao" não basta: só os slugs fixos da demonstração passam.
  const outra = await criarArenaComDono(db, { arena: "Outra", email: "outro@verdade.com", senha: "senha-bem-longa" });
  await db.query("update arenas set slug = 'arena-exemplo-falsa-demonstracao' where id = $1", [outra.arenaId]);
  expect(await arenasForaDaDemo(db)).toBe(2);
});

test("banco com outras arenas (túnel para um banco remoto?) só recebe a demonstração com SEED_DEMO_FORCAR=1", () => {
  expect(podeSemear(0, undefined)).toBe(true);
  expect(podeSemear(0, "0")).toBe(true);
  expect(podeSemear(1, undefined)).toBe(false);
  expect(podeSemear(3, "")).toBe(false);
  expect(podeSemear(3, "0")).toBe(false);
  expect(podeSemear(3, "true")).toBe(false);
  expect(podeSemear(3, "1")).toBe(true);
});

test("semearDemo monta a Arena Exemplo com quadras, horários, câmera, botão, dono e jogador com reserva", async () => {
  const db = await novoBanco();
  const r = await semearDemo(db, { agora: AGORA });

  // "arena-exemplo" não cabe no check do slug (20 a 64 caracteres).
  expect(r.arenaSlug).toBe("arena-exemplo-demonstracao");
  expect(SLUG_VALIDO.test(r.arenaSlug)).toBe(true);
  const arena = (await db.query<{ id: string; nome: string; slug: string; status: string; dias: number }>(
    "select id, nome, slug, status_assinatura as status, dias_retencao as dias from arenas where slug = $1",
    [r.arenaSlug],
  )).rows;
  expect(arena).toEqual([{ id: expect.any(String), nome: "Arena Exemplo", slug: r.arenaSlug, status: "ativa", dias: 7 }]);
  const arenaId = arena[0].id;

  const quadras = await quadrasDa(db, arenaId);
  expect(quadras.map((q) => q.nome)).toEqual(["Quadra 1 — Society", "Quadra 2 — Areia"]);
  const q1 = quadras[0];

  // Segunda a domingo, das 17:00 às 23:00, horários de 1 h com preço.
  for (const q of quadras) {
    const hs = (await db.query<{ dia_semana: number; inicio: number; fim: number; preco_centavos: number }>(
      "select dia_semana, inicio, fim, preco_centavos from horarios_quadra where quadra_id = $1", [q.id])).rows;
    expect(hs).toHaveLength(7 * 6);
    expect(new Set(hs.map((h) => Number(h.dia_semana)))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(Math.min(...hs.map((h) => Number(h.inicio)))).toBe(17 * 60);
    expect(Math.max(...hs.map((h) => Number(h.fim)))).toBe(23 * 60);
    expect(hs.every((h) => Number(h.fim) - Number(h.inicio) === 60 && Number(h.preco_centavos) > 0)).toBe(true);
  }

  // Uma câmera e um botão ativo, os dois na Quadra 1 (as outras arenas não têm câmera).
  const cams = (await db.query<{ quadra_id: string }>("select quadra_id from cameras")).rows;
  expect(cams).toEqual([{ quadra_id: q1.id }]);
  const botoes = (await db.query<{ quadra_id: string; revogado_em: Date | null }>(
    "select quadra_id, revogado_em from botoes")).rows;
  expect(botoes).toEqual([{ quadra_id: q1.id, revogado_em: null }]);

  // Dono e jogador entram com as senhas geradas (só no retorno, para o CLI gravar).
  const dono = (await db.query<{ arena_id: string; papel: string }>(
    "select arena_id, papel from usuarios where email = 'dono@exemplo.invalid'")).rows;
  expect(dono).toEqual([{ arena_id: arenaId, papel: "dono" }]);
  expect(Object.keys(r.segredos).sort()).toEqual(["DEMO_BOTAO_TOKEN", "DEMO_DONO_SENHA", "DEMO_JOGADOR_SENHA"]);
  expect((await entrarUnico(db, "dono@exemplo.invalid", r.segredos.DEMO_DONO_SENHA!, "127.0.0.1")).ok).toBe(true);
  expect((await entrarUnico(db, EMAIL_JOGADOR, r.segredos.DEMO_JOGADOR_SENHA!, "127.0.0.1")).ok).toBe(true);

  // Reserva confirmada para hoje (São Paulo), 20:00 às 21:00, na Quadra 1.
  const reservas = (await db.query<{ quadra_id: string; tipo: string; situacao: string; inicio: Date; fim: Date; email: string }>(
    `select r.quadra_id, r.tipo, r.situacao, r.inicio, r.fim, j.email
       from reservas r join jogadores j on j.id = r.jogador_id
      where j.email = $1 and r.inicio >= $2 and r.inicio < $3`,
    [EMAIL_JOGADOR, new Date("2026-11-09T00:00:00-03:00"), new Date("2026-11-10T00:00:00-03:00")],
  )).rows;
  expect(reservas).toEqual([{
    quadra_id: q1.id, tipo: "reserva", situacao: "confirmada",
    inicio: new Date("2026-11-09T20:00:00-03:00"), fim: new Date("2026-11-09T21:00:00-03:00"),
    email: EMAIL_JOGADOR,
  }]);

  // Aparece na página pública e no mapa (endereço fictício, coordenadas sem rede).
  const pub = await arenaPublica(db, r.arenaSlug);
  expect(pub?.nome).toBe("Arena Exemplo");
  expect(pub?.quadras).toHaveLength(2);
  expect((await arenasNoMapa(db)).map((a) => a.slug)).toContain(r.arenaSlug);

  // Sem câmera de verdade nem R2 não existe vídeo: nenhum lance inventado.
  expect(await contar(db, "clipes")).toBe(0);
});

test("duas arenas de demonstração a mais, sem câmera, para a busca mostrar mais de um resultado", async () => {
  const db = await novoBanco();
  const r = await semearDemo(db, { agora: AGORA });
  expect(r.outrasArenas).toHaveLength(2);

  const arenas = (await db.query<{ nome: string; slug: string; cidade: string; uf: string; cep: string }>(
    "select nome, slug, endereco_cidade as cidade, endereco_uf as uf, endereco_cep as cep from arenas order by nome")).rows;
  expect(arenas.map((a) => a.slug).sort()).toEqual([r.arenaSlug, ...r.outrasArenas].sort());
  for (const a of arenas) {
    expect(a.nome).toMatch(/^Arena Exemplo/);
    expect(SLUG_VALIDO.test(a.slug)).toBe(true);
    expect(a.slug).toMatch(/-demonstracao$/);
    expect([a.cidade, a.uf]).toEqual(["São Paulo", "SP"]);
    // CEP obviamente falso: um CEP de verdade da região poderia cair numa rua real.
    expect(a.cep).toMatch(/^00000\d{3}$/);
  }

  // Cada uma tem quadras com esporte, horários e preço, e nenhuma câmera.
  for (const slug of r.outrasArenas) {
    const pub = await arenaPublica(db, slug);
    expect(pub?.ativa).toBe(true);
    expect(pub!.quadras.length).toBeGreaterThanOrEqual(1);
    for (const q of pub!.quadras) {
      expect(q.esporte).not.toBe("");
      expect(q.horarios.length).toBeGreaterThan(0);
      expect(q.aPartirDe).toBeGreaterThan(0);
    }
    const cams = await db.query("select 1 from cameras c join arenas a on a.id = c.arena_id where a.slug = $1", [slug]);
    expect(cams.rows).toHaveLength(0);
  }
  expect(await contar(db, "cameras")).toBe(1);

  // Busca, filtro de esporte e mapa (coordenadas distintas, dentro de São Paulo, sem rede).
  expect(await cartoesDeArenas(db, { busca: "exemplo" })).toHaveLength(3);
  expect(await esportesDasArenas(db)).toEqual(expect.arrayContaining(["Beach tennis", "Padel"]));
  const mapa = await arenasNoMapa(db);
  expect(mapa).toHaveLength(3);
  expect(new Set(mapa.map((p) => `${p.latitude},${p.longitude}`)).size).toBe(3);
  for (const p of mapa) {
    expect(p.latitude).toBeGreaterThan(-23.8);
    expect(p.latitude).toBeLessThan(-23.4);
    expect(p.longitude).toBeGreaterThan(-46.9);
    expect(p.longitude).toBeLessThan(-46.4);
  }
});

test("a agenda da Arena Exemplo tem hoje quase cheio, os próximos 14 dias, 30 dias de histórico e bloqueios", async () => {
  const db = await novoBanco();
  const r = await semearDemo(db, { agora: AGORA });
  const arenaId = await idDaArena(db, r.arenaSlug);
  const quadras = await quadrasDa(db, arenaId);

  // Hoje: 4 dos 6 horários de cada quadra ocupados; sobram livres para a busca e a página da arena.
  for (const q of quadras) {
    expect(await ocupadosNoDia(db, arenaId, q.id, "2026-11-09", AGORA)).toEqual({ total: 6, ocupados: 4 });
  }
  // 6 reservas dos jogadores fictícios mais a do jogador principal.
  expect((await resumoDoMes(db, arenaId, null, "2026-11", AGORA)).hoje).toBe(7);

  // Próximos 14 dias: reserva todo dia, algumas com mais de um horário seguido.
  const proximos = await agendaDaArena(db, arenaId, AGORA, { de: "2026-11-10", ate: "2026-11-23" });
  const futuras = proximos.filter((i) => i.tipo === "reserva" && i.situacao === "confirmada");
  expect(new Set(futuras.map((i) => hojeLocal(i.inicio))).size).toBe(14);
  expect(futuras.some((i) => i.fim.getTime() - i.inicio.getTime() >= 2 * HORA)).toBe(true);
  expect(futuras.length).toBeGreaterThanOrEqual(20);
  expect(futuras.every((i) => i.pagamento === "arena" && i.jogador?.endsWith(" Exemplo"))).toBe(true);

  // Os próximos dias também têm canceladas dos fictícios, pelo jogador e pela
  // arena: rodando o seed todo dia, cada dia que passa leva as suas para o histórico.
  const canceladasFuturas = proximos.filter(
    (i) => i.tipo === "reserva" && i.situacao === "cancelada" && i.jogador !== "Jogador Exemplo");
  expect(canceladasFuturas.some((i) => i.canceladaPor === "jogador")).toBe(true);
  expect(canceladasFuturas.some((i) => i.canceladaPor === "dono" && !!i.motivoCancelamento)).toBe(true);

  // Bloqueios com motivo, pela função do painel, em dias próximos.
  const bloqueios = proximos.filter((i) => i.tipo === "bloqueio" && i.situacao === "confirmada");
  expect(new Set(bloqueios.map((b) => b.motivo))).toEqual(new Set(["Aula de beach tennis", "Manutenção do piso"]));
  expect(bloqueios.every((b) => b.futura)).toBe(true);

  // Últimos 30 dias: reserva todo dia, algumas canceladas pelo jogador e pela arena (com motivo).
  const passados = await agendaDaArena(db, arenaId, AGORA, { de: "2026-10-10", ate: "2026-11-08" });
  const historico = passados.filter((i) => i.tipo === "reserva");
  expect(new Set(historico.map((i) => hojeLocal(i.inicio))).size).toBe(30);
  const canceladas = historico.filter((i) => i.situacao === "cancelada");
  expect(canceladas.length).toBeGreaterThanOrEqual(3);
  expect(canceladas.some((i) => i.canceladaPor === "jogador")).toBe(true);
  expect(canceladas.some((i) => i.canceladaPor === "dono" && !!i.motivoCancelamento)).toBe(true);
  expect(historico.filter((i) => i.situacao === "confirmada").length).toBeGreaterThan(3 * canceladas.length);
});

test("jogadores fictícios sem senha guardada, dentro do limite do app, e o principal com histórico, futura e cancelada", async () => {
  const db = await novoBanco();
  const r = await semearDemo(db, { agora: AGORA });
  // Só o dono e o jogador principal têm senha guardada (no .env.local, pelo CLI).
  expect(Object.keys(r.segredos).sort()).toEqual(["DEMO_BOTAO_TOKEN", "DEMO_DONO_SENHA", "DEMO_JOGADOR_SENHA"]);

  const jogadores = (await db.query<{ id: string; nome: string; email: string }>(
    "select id, nome, email from jogadores order by email")).rows;
  expect(jogadores.length).toBeGreaterThanOrEqual(7);
  for (const j of jogadores) {
    expect(j.nome).toMatch(/ Exemplo$/);
    expect(j.email).toMatch(/@exemplo\.invalid$/);
  }
  // Todos aparecem na agenda.
  const comReserva = await db.query<{ n: number }>(
    "select count(distinct jogador_id)::int as n from reservas where tipo = 'reserva'");
  expect(Number(comReserva.rows[0].n)).toBe(jogadores.length);
  // Ninguém fura o limite do app de reservas futuras por arena.
  const porJogador = (await db.query<{ n: number }>(
    `select count(*)::int as n from reservas
      where tipo = 'reserva' and situacao = 'confirmada' and fim > $1 group by jogador_id, arena_id`,
    [AGORA],
  )).rows.map((x) => Number(x.n));
  expect(Math.max(...porJogador)).toBeLessThanOrEqual(LIMITE_RESERVAS_POR_ARENA);

  // Jogador principal: hoje às 20h na Arena Exemplo e uma futura na Arena
  // Exemplo Padel; no histórico (Arena Exemplo), uma ou duas jogadas e uma
  // cancelada por ele, no passado (o Histórico começa pelo mais recente).
  const principal = jogadores.find((j) => j.email === EMAIL_JOGADOR)!;
  const { proximas, historico } = await reservasDoJogador(db, principal.id, AGORA);
  expect(proximas).toHaveLength(2);
  expect(proximas[0].inicio).toEqual(new Date("2026-11-09T20:00:00-03:00"));
  expect(proximas[0].arena.slug).toBe(r.arenaSlug);
  expect(proximas[1].inicio.getTime()).toBeGreaterThanOrEqual(new Date("2026-11-10T00:00:00-03:00").getTime());
  expect(proximas[1].arena.slug).toBe("arena-exemplo-padel-demonstracao");
  expect(proximas[1].podeCancelar).toBe(true);
  const jogadas = historico.filter((h) => h.situacao === "confirmada");
  expect(jogadas.length).toBeGreaterThanOrEqual(1);
  expect(jogadas.length).toBeLessThanOrEqual(2);
  expect(jogadas.every((h) => h.fim.getTime() <= AGORA.getTime())).toBe(true);
  const cancelada = historico.filter((h) => h.situacao === "cancelada");
  expect(cancelada).toHaveLength(1);
  expect(cancelada[0].canceladaPor).toBe("jogador");
  expect(cancelada[0].fim.getTime()).toBeLessThanOrEqual(AGORA.getTime());
  expect(historico.every((h) => h.arena.slug === r.arenaSlug)).toBe(true);

  // Sobra uma vaga do limite na Arena Exemplo: a conta serve para testar uma reserva nova nela.
  const arenaId = await idDaArena(db, r.arenaSlug);
  const [q1] = await quadrasDa(db, arenaId);
  const nova = await criarReserva(db, principal.id, { quadraId: q1.id, dia: "2026-11-10", inicio: 17 * 60, qtd: 1 }, AGORA);
  expect(nova).toEqual({ ok: true, reservaId: expect.any(String), pagarOnline: false });
});

test("depois das 20h a reserva de hoje às 20:00 ainda é criada", async () => {
  const db = await novoBanco();
  await semearDemo(db, { agora: new Date("2026-11-09T22:30:00-03:00") });
  const r = (await db.query<{ inicio: Date; situacao: string }>(
    `select r.inicio, r.situacao from reservas r join jogadores j on j.id = r.jogador_id
      where j.email = $1 and r.inicio >= $2 and r.inicio < $3`,
    [EMAIL_JOGADOR, new Date("2026-11-09T00:00:00-03:00"), new Date("2026-11-10T00:00:00-03:00")],
  )).rows;
  expect(r).toEqual([{ inicio: new Date("2026-11-09T20:00:00-03:00"), situacao: "confirmada" }]);
});

test("rodar duas vezes não duplica nada e não gera segredos novos", async () => {
  const db = await novoBanco();
  const primeira = await semearDemo(db, { agora: AGORA });
  const antes = await contagens(db);
  const segunda = await semearDemo(db, { agora: AGORA });
  expect(segunda.arenaSlug).toBe(primeira.arenaSlug);
  expect(segunda.outrasArenas).toEqual(primeira.outrasArenas);
  expect(segunda.segredos).toEqual({});
  expect(await contagens(db)).toEqual(antes);
  // Mais tarde no mesmo dia (bloqueio e reserva de hoje já começados): também não cria nada.
  const terceira = await semearDemo(db, { agora: new Date("2026-11-09T22:30:00-03:00") });
  expect(terceira.segredos).toEqual({});
  expect(await contagens(db)).toEqual(antes);
  // 3 arenas (2 + 2 + 2 quadras; 84 + 66 + 50 horários), 3 donos, 17 jogadores,
  // 87 reservas (82 dos fictícios e 5 do principal) e 6 bloqueios.
  expect(antes).toEqual({
    arenas: 3, quadras: 6, horarios_quadra: 200, cameras: 1, botoes: 1, usuarios: 3, jogadores: 17, reservas: 93,
    clipes: 0,
  });
});

// Os prints pedem uma reserva no dia em que são tirados: a de outro dia, ou a
// cancelada, não serve e não impede o seed de criar a de hoje. Em outro dia o
// seed completa a agenda (hoje cheio, o 14º dia à frente) sem duplicar nada.
test("em outro dia, ou com a de hoje cancelada, o seed cria a reserva de hoje às 20:00 e completa a agenda", async () => {
  const db = await novoBanco();
  await semearDemo(db, { agora: AGORA });
  const amanha = new Date("2026-11-10T10:00:00-03:00");
  await semearDemo(db, { agora: amanha });
  await db.query("update reservas set situacao = 'cancelada' where inicio = $1", [new Date("2026-11-10T20:00:00-03:00")]);
  const r = await semearDemo(db, { agora: amanha });
  const doPrincipal = (await db.query<{ inicio: Date; situacao: string }>(
    `select r.inicio, r.situacao from reservas r join jogadores j on j.id = r.jogador_id
      where j.email = $1 and r.inicio in ($2, $3)
      order by r.inicio, r.situacao`,
    [EMAIL_JOGADOR, new Date("2026-11-09T20:00:00-03:00"), new Date("2026-11-10T20:00:00-03:00")],
  )).rows;
  expect(doPrincipal).toEqual([
    { inicio: new Date("2026-11-09T20:00:00-03:00"), situacao: "confirmada" },
    { inicio: new Date("2026-11-10T20:00:00-03:00"), situacao: "cancelada" },
    { inicio: new Date("2026-11-10T20:00:00-03:00"), situacao: "confirmada" },
  ]);

  // Nada duplicado: só o horário cancelado à mão tem duas linhas.
  const repetidos = (await db.query<{ inicio: Date; n: number }>(
    "select inicio, count(*)::int as n from reservas group by quadra_id, inicio having count(*) > 1")).rows;
  expect(repetidos).toEqual([{ inicio: new Date("2026-11-10T20:00:00-03:00"), n: 2 }]);

  // O novo hoje (10/11) também fica com 4 dos 6 horários de cada quadra, e o
  // 14º dia à frente (24/11) ganha reserva.
  const arenaId = await idDaArena(db, r.arenaSlug);
  for (const q of await quadrasDa(db, arenaId)) {
    expect(await ocupadosNoDia(db, arenaId, q.id, "2026-11-10", amanha)).toEqual({ total: 6, ocupados: 4 });
  }
  const dia24 = await agendaDaArena(db, arenaId, amanha, { de: "2026-11-24", ate: "2026-11-24" });
  expect(dia24.some((i) => i.tipo === "reserva" && i.situacao === "confirmada")).toBe(true);
});

// Banco local semeado de novo dias depois: os dias que eram futuros viram
// histórico e levam as canceladas junto (antes só a primeira rodada as criava).
test("dias depois, o histórico continua com canceladas nos dias que eram futuros, sem duplicar nada", async () => {
  const db = await novoBanco();
  await semearDemo(db, { agora: AGORA });
  const depois = new Date("2026-11-24T10:00:00-03:00");
  const r = await semearDemo(db, { agora: depois });
  const arenaId = await idDaArena(db, r.arenaSlug);

  const eramFuturos = (await agendaDaArena(db, arenaId, depois, { de: "2026-11-10", ate: "2026-11-23" }))
    .filter((i) => i.tipo === "reserva" && i.jogador !== "Jogador Exemplo");
  const canceladas = eramFuturos.filter((i) => i.situacao === "cancelada");
  expect(canceladas.some((i) => i.canceladaPor === "jogador")).toBe(true);
  expect(canceladas.some((i) => i.canceladaPor === "dono" && !!i.motivoCancelamento)).toBe(true);
  // Todo dia continua com reserva confirmada (só cancela em dia com mais de uma).
  const confirmadas = eramFuturos.filter((i) => i.situacao === "confirmada");
  expect(new Set(confirmadas.map((i) => hojeLocal(i.inicio))).size).toBe(14);

  const repetidos = await db.query("select 1 from reservas group by quadra_id, inicio having count(*) > 1");
  expect(repetidos.rows).toHaveLength(0);
});

// O principal ganha a reserva de hoje às 20h a cada dia, e a futura da Padel
// chega ao "hoje" alguns dias depois: nunca dois jogos ao mesmo tempo, e no
// máximo uma reserva por vir na Padel (sobra vaga do limite nas duas arenas).
test("no dia da reserva da Padel, ninguém fica com dois jogos ao mesmo tempo e o principal tem uma por vir em cada arena", async () => {
  const db = await novoBanco();
  await semearDemo(db, { agora: AGORA });
  const diaDaPadel = new Date("2026-11-12T10:00:00-03:00");
  await semearDemo(db, { agora: diaDaPadel });

  const sobrepostas = await db.query(
    `select a.id from reservas a
       join reservas b on b.jogador_id = a.jogador_id and b.id > a.id and a.inicio < b.fim and b.inicio < a.fim
      where a.tipo = 'reserva' and b.tipo = 'reserva' and a.situacao = 'confirmada' and b.situacao = 'confirmada'`);
  expect(sobrepostas.rows).toEqual([]);

  const principal = (await db.query<{ id: string }>("select id from jogadores where email = $1", [EMAIL_JOGADOR])).rows[0];
  const { proximas } = await reservasDoJogador(db, principal.id, diaDaPadel);
  expect(proximas.map((p) => p.arena.slug).sort()).toEqual(["arena-exemplo-demonstracao", "arena-exemplo-padel-demonstracao"]);
});

// Mudar o endereço (por exemplo, o CEP) apaga as coordenadas e só geocodifica
// de novo depois de um minuto: o seed avisa em vez de deixar a arena fora do mapa.
test("endereço trocado dentro do minuto da última geocodificação: o seed recusa e pede para rodar de novo", async () => {
  const db = await novoBanco();
  const a = await criarArenaComDono(db, { arena: "Arena Exemplo", email: "dono@exemplo.invalid", senha: "senha-bem-longa" });
  await db.query(
    `update arenas set slug = 'arena-exemplo-demonstracao', endereco_rua = 'Rua do Exemplo', endereco_numero = '100',
       endereco_bairro = 'Ibirapuera', endereco_cidade = 'São Paulo', endereco_uf = 'SP', endereco_cep = '04094000',
       latitude = -23.5874, longitude = -46.6576, geocodificacao_tentada_em = now()
     where id = $1`,
    [a.arenaId],
  );
  await expect(semearDemo(db, { agora: AGORA })).rejects.toThrow("rode de novo");
});

test("se um passo falhar, os segredos do que já foi criado ficam com o chamador", async () => {
  const db = await novoBanco();
  // O e-mail do jogador já é de um dono: a conta do jogador é recusada depois do dono e do botão.
  await criarArenaComDono(db, { arena: "Outra", email: EMAIL_JOGADOR, senha: "senha-bem-longa" });
  const segredos: SegredosDemo = {};
  await expect(semearDemo(db, { agora: AGORA, segredos })).rejects.toThrow("email_em_uso");
  expect(Object.keys(segredos).sort()).toEqual(["DEMO_BOTAO_TOKEN", "DEMO_DONO_SENHA"]);
});

test("comSegredosNoEnv troca só as chaves da demonstração e mantém o resto do arquivo", () => {
  const atual = "A=1\r\nDEMO_DONO_SENHA=velha\r\n# nota\r\nB=2\r\n";
  expect(comSegredosNoEnv(atual, { DEMO_DONO_SENHA: "nova", DEMO_BOTAO_TOKEN: "tok" })).toBe(
    "A=1\r\n# nota\r\nB=2\r\n# Arena de demonstração (npm run seed-demo): só no banco local.\r\n" +
      "DEMO_DONO_SENHA=nova\r\nDEMO_BOTAO_TOKEN=tok\r\n",
  );
  expect(comSegredosNoEnv("", { DEMO_JOGADOR_SENHA: "x" })).toBe(
    "# Arena de demonstração (npm run seed-demo): só no banco local.\nDEMO_JOGADOR_SENHA=x\n",
  );
  // Rodar de novo não repete o comentário; arquivo sem quebra no fim continua inteiro.
  const duas = comSegredosNoEnv(comSegredosNoEnv("A=1", { DEMO_DONO_SENHA: "a" }), { DEMO_DONO_SENHA: "b" });
  expect(duas).toBe("A=1\n# Arena de demonstração (npm run seed-demo): só no banco local.\nDEMO_DONO_SENHA=b\n");
  expect(comSegredosNoEnv("A=1\n", {})).toBe("A=1\n");
});

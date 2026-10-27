import { expect, test } from "vitest";
import type { Db } from "../app/lib/db";
import { SLUG_VALIDO } from "../app/lib/clipes";
import { arenaPublica, arenasNoMapa } from "../app/lib/arenas-publicas";
import { entrarUnico } from "../app/lib/entrar-unico";
import { criarArenaComDono } from "../app/lib/donos";
import { comSegredosNoEnv, semearDemo, urlLocal, type SegredosDemo } from "../db/seed-demo";
import { novoBanco } from "./db";

// Segunda, 09/11/2026, 10h em São Paulo.
const AGORA = new Date("2026-11-09T10:00:00-03:00");

const contar = async (db: Db, tabela: string) =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from ${tabela}`)).rows[0].n);

const TABELAS = ["arenas", "quadras", "horarios_quadra", "cameras", "botoes", "usuarios", "jogadores", "reservas"];
const contagens = async (db: Db) =>
  Object.fromEntries(await Promise.all(TABELAS.map(async (t) => [t, await contar(db, t)] as const)));

test("urlLocal aceita só banco em localhost, 127.0.0.1 ou ::1", () => {
  expect(urlLocal("postgres://u@localhost:5432/x")).toBe(true);
  expect(urlLocal("postgresql://u:p@127.0.0.1/x")).toBe(true);
  expect(urlLocal("postgres://u@[::1]:5432/x")).toBe(true);
  expect(urlLocal("postgres://u@LOCALHOST/x")).toBe(true);
  expect(urlLocal("postgres://u@db.xyz.supabase.co:5432/x")).toBe(false);
  expect(urlLocal("postgres://u@localhost.exemplo.com/x")).toBe(false);
  // O pg troca o host da URL pelo ?host=.
  expect(urlLocal("postgres://u@localhost/x?host=db.xyz.supabase.co")).toBe(false);
  expect(urlLocal("postgres:///x")).toBe(false);
  expect(urlLocal("/var/run/postgresql x")).toBe(false);
  expect(urlLocal("http://localhost/x")).toBe(false);
  expect(urlLocal("isso não é url")).toBe(false);
});

test("semearDemo monta a Arena Exemplo com quadras, horários, câmera, botão, dono e jogador com reserva", async () => {
  const db = await novoBanco();
  const r = await semearDemo(db, { agora: AGORA });

  // "arena-exemplo" não cabe no check do slug (20 a 64 caracteres).
  expect(r.arenaSlug).toBe("arena-exemplo-demonstracao");
  expect(SLUG_VALIDO.test(r.arenaSlug)).toBe(true);
  const arena = (await db.query<{ id: string; nome: string; slug: string; status: string; dias: number }>(
    "select id, nome, slug, status_assinatura as status, dias_retencao as dias from arenas",
  )).rows;
  expect(arena).toEqual([{ id: expect.any(String), nome: "Arena Exemplo", slug: r.arenaSlug, status: "ativa", dias: 7 }]);
  const arenaId = arena[0].id;

  const quadras = (await db.query<{ id: string; nome: string }>(
    "select id, nome from quadras where arena_id = $1 order by nome", [arenaId])).rows;
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

  // Uma câmera e um botão ativo, os dois na Quadra 1.
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
  expect((await entrarUnico(db, "jogador@exemplo.invalid", r.segredos.DEMO_JOGADOR_SENHA!, "127.0.0.1")).ok).toBe(true);

  // Reserva confirmada para hoje (São Paulo), 20:00 às 21:00, na Quadra 1.
  const reservas = (await db.query<{ quadra_id: string; tipo: string; situacao: string; inicio: Date; fim: Date; email: string }>(
    `select r.quadra_id, r.tipo, r.situacao, r.inicio, r.fim, j.email
       from reservas r join jogadores j on j.id = r.jogador_id`)).rows;
  expect(reservas).toEqual([{
    quadra_id: q1.id, tipo: "reserva", situacao: "confirmada",
    inicio: new Date("2026-11-09T20:00:00-03:00"), fim: new Date("2026-11-09T21:00:00-03:00"),
    email: "jogador@exemplo.invalid",
  }]);

  // Aparece na página pública e no mapa (endereço fictício, coordenadas sem rede).
  const pub = await arenaPublica(db, r.arenaSlug);
  expect(pub?.nome).toBe("Arena Exemplo");
  expect(pub?.quadras).toHaveLength(2);
  expect((await arenasNoMapa(db)).map((a) => a.slug)).toEqual([r.arenaSlug]);
});

test("depois das 20h a reserva de hoje às 20:00 ainda é criada", async () => {
  const db = await novoBanco();
  await semearDemo(db, { agora: new Date("2026-11-09T22:30:00-03:00") });
  const r = (await db.query<{ inicio: Date; situacao: string }>("select inicio, situacao from reservas")).rows;
  expect(r).toEqual([{ inicio: new Date("2026-11-09T20:00:00-03:00"), situacao: "confirmada" }]);
});

test("rodar duas vezes não duplica nada e não gera segredos novos", async () => {
  const db = await novoBanco();
  const primeira = await semearDemo(db);
  const antes = await contagens(db);
  const segunda = await semearDemo(db);
  expect(segunda.arenaSlug).toBe(primeira.arenaSlug);
  expect(segunda.segredos).toEqual({});
  expect(await contagens(db)).toEqual(antes);
  expect(antes).toEqual({
    arenas: 1, quadras: 2, horarios_quadra: 84, cameras: 1, botoes: 1, usuarios: 1, jogadores: 1, reservas: 1,
  });
});

test("se um passo falhar, os segredos do que já foi criado ficam com o chamador", async () => {
  const db = await novoBanco();
  // O e-mail do jogador já é de um dono: a conta do jogador é recusada depois do dono e do botão.
  await criarArenaComDono(db, { arena: "Outra", email: "jogador@exemplo.invalid", senha: "senha-bem-longa" });
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

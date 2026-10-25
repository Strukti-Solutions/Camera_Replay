import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena, criarHorariosDeHora, criarQuadra } from "./fixtures";
import {
  arenaPublica, arenasNoMapa, listarArenasPublicas, periodosPublicos, slugDaQuadra, sugestoesArenas,
} from "../app/lib/arenas-publicas";
import { criarContaJogador } from "../app/lib/jogadores";
import { criarReserva } from "../app/lib/reservas";
import type { Db } from "../app/lib/db";

async function endereco(
  db: Db, id: string, e: { rua?: string; bairro?: string; cidade?: string; uf?: string; lat?: number; lng?: number },
) {
  await db.query(
    `update arenas set endereco_rua = $2, endereco_numero = '10', endereco_bairro = $3, endereco_cidade = $4,
       endereco_uf = $5, endereco_cep = '01000000', latitude = $6, longitude = $7 where id = $1`,
    [id, e.rua ?? null, e.bairro ?? null, e.cidade ?? null, e.uf ?? null, e.lat ?? null, e.lng ?? null],
  );
}

test("busca sem acento e sem maiúscula por nome e endereço", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena Beira-Mar");
  await endereco(db, a.id, { rua: "Av. Beira Mar", bairro: "Meireles", cidade: "Fortaleza", uf: "CE" });
  const b = await criarArena(db, "Arena Paulista");
  await endereco(db, b.id, { rua: "Rua Augusta", bairro: "Consolação", cidade: "São Paulo", uf: "SP" });
  const nomes = async (t: string) => (await listarArenasPublicas(db, t)).map((x) => x.nome);
  expect(await nomes("sao paulo")).toEqual(["Arena Paulista"]);
  expect(await nomes("BEIRA")).toEqual(["Arena Beira-Mar"]);
  expect(await nomes("meireles")).toEqual(["Arena Beira-Mar"]);
  expect(await nomes("CONSOLAÇÃO")).toEqual(["Arena Paulista"]);
  expect(await nomes("augusta")).toEqual(["Arena Paulista"]);
  expect(await nomes("ce")).toContain("Arena Beira-Mar");
  expect((await listarArenasPublicas(db, "beira"))[0]).toEqual({ nome: "Arena Beira-Mar", slug: a.slug, cidade: "Fortaleza" });
});

test("curinga é literal", async () => {
  const db = await novoBanco();
  await criarArena(db, "Arena Um");
  await criarArena(db, "Quadra 50% off");
  expect((await listarArenasPublicas(db, "50%")).map((x) => x.nome)).toEqual(["Quadra 50% off"]);
  expect(await listarArenasPublicas(db, "_")).toEqual([]);
  expect(await sugestoesArenas(db, "%%")).toEqual([]);
});

test("suspensa fora da busca, das sugestões e do mapa", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena Suspensa");
  await endereco(db, a.id, { cidade: "Recife", lat: -8, lng: -35 });
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [a.id]);
  expect(await listarArenasPublicas(db, "suspensa")).toEqual([]);
  expect(await sugestoesArenas(db, "suspensa")).toEqual([]);
  expect(await arenasNoMapa(db)).toEqual([]);
});

test("mapa só com coordenadas", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Com Coord");
  await endereco(db, a.id, { lat: -3.7, lng: -38.5 });
  await criarArena(db, "Sem Coord");
  const m = await arenasNoMapa(db);
  expect(m).toEqual([{ nome: "Com Coord", slug: a.slug, latitude: -3.7, longitude: -38.5 }]);
});

test("sugestões: termo curto não consulta, no máximo 8", async () => {
  const db = await novoBanco();
  for (let i = 0; i < 12; i++) await criarArena(db, `Sugere ${String(i).padStart(2, "0")}`);
  const espiao = { query: () => { throw new Error("não devia consultar"); } } as unknown as Db;
  expect(await sugestoesArenas(espiao, "a")).toEqual([]);
  expect(await sugestoesArenas(espiao, " a ")).toEqual([]);
  expect(await sugestoesArenas(espiao, "x".repeat(81))).toEqual([]);
  expect(await sugestoesArenas(db, "sugere")).toHaveLength(8);
  expect(await sugestoesArenas(db, "su\u0000ge")).toHaveLength(8);
});

test("arenaPublica devolve quadras com horários ordenados e nada privado", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena Pública");
  await endereco(db, a.id, { rua: "Rua A", bairro: "B", cidade: "C", uf: "SP", lat: 1, lng: 2 });
  await db.query("update arenas set taxa_percentual = 7 where id = $1", [a.id]);
  const q = await criarQuadra(db, a.id);
  await db.query("update quadras set esporte = 'Futevôlei' where id = $1", [q.id]);
  for (const [d, i, f, p] of [[2, 1080, 1200, 9000], [1, 540, 600, 5000], [1, 480, 540, 4000]]) {
    await db.query(
      "insert into horarios_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos) values ($1,$2,$3,$4,$5,$6)",
      [a.id, q.id, d, i, f, p],
    );
  }
  const r = await arenaPublica(db, a.slug);
  expect(r).not.toBeNull();
  expect(Object.keys(r!).sort()).toEqual(["ativa", "endereco", "latitude", "longitude", "nome", "quadras", "slug"]);
  expect(Object.keys(r!.endereco!).sort()).toEqual(["bairro", "cep", "cidade", "numero", "rua", "uf"]);
  expect(r!.latitude).toBe(1);
  expect(r!.quadras).toHaveLength(1);
  expect(Object.keys(r!.quadras[0]).sort()).toEqual(["esporte", "horarios", "id", "nome"]);
  expect(r!.quadras[0].esporte).toBe("Futevôlei");
  expect(r!.quadras[0].horarios.every((x) => /^[0-9a-f-]{36}$/.test(x.id))).toBe(true);
  expect(r!.quadras[0].horarios.map(({ id: _id, ...resto }) => resto)).toEqual([
    { diaSemana: 1, inicio: 480, fim: 540, precoCentavos: 4000 },
    { diaSemana: 1, inicio: 540, fim: 600, precoCentavos: 5000 },
    { diaSemana: 2, inicio: 1080, fim: 1200, precoCentavos: 9000 },
  ]);
  const json = JSON.stringify(r);
  expect(json).not.toContain("@");
  expect(json).not.toMatch(/taxa/i);
  expect(json).not.toMatch(/\bsn\b/i);
});

test("arenaPublica: suspensa sem quadras; slug malformado sem consulta", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena X");
  await criarQuadra(db, a.id);
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [a.id]);
  const r = await arenaPublica(db, a.slug);
  expect(r).toMatchObject({ nome: "Arena X", ativa: false, quadras: [] });
  expect(await arenaPublica(db, "x'; drop")).toBeNull();
  const espiao = { query: () => { throw new Error("não devia consultar"); } } as unknown as Db;
  expect(await arenaPublica(espiao, "curto")).toBeNull();
  expect(await arenaPublica(db, "a".repeat(30))).toBeNull();
});

test("maiúsculas acentuadas na coluna e termo só de marcas combinantes", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena Maiúscula");
  await endereco(db, a.id, { bairro: "ÇARAPUÁ", cidade: "SÃO PAULO", uf: "SP" });
  expect((await listarArenasPublicas(db, "sao paulo")).map((x) => x.nome)).toEqual(["Arena Maiúscula"]);
  expect((await listarArenasPublicas(db, "carapua")).map((x) => x.nome)).toEqual(["Arena Maiúscula"]);
  expect(await sugestoesArenas(db, "\u0301\u0301")).toEqual([]);
  expect(await listarArenasPublicas(db, "\u0301\u0301")).toHaveLength(1);
});

test("slugDaQuadra: slug da arena da quadra; id estranho sem consulta", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena Q");
  const q = await criarQuadra(db, a.id);
  expect(await slugDaQuadra(db, q.id)).toBe(a.slug);
  expect(await slugDaQuadra(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  const espiao = { query: () => { throw new Error("não devia consultar"); } } as unknown as Db;
  expect(await slugDaQuadra(espiao, "x'; drop")).toBeNull();
  expect(await slugDaQuadra(espiao, undefined as unknown as string)).toBeNull();
});

test("periodosPublicos: só início e fim das reservas da quadra no dia", async () => {
  const db = await novoBanco();
  const agora = new Date("2026-11-09T10:00:00-03:00");
  const a = await criarArena(db, "Arena O");
  const q = await criarQuadra(db, a.id);
  const outra = await criarQuadra(db, a.id);
  await criarHorariosDeHora(db, a.id, q.id, [0, 1, 2, 3, 4, 5, 6], 7, 23, 10000);
  const j = await criarContaJogador(db, { nome: "Ana", email: "ana@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!j.ok) throw new Error("conta");
  const r = await criarReserva(db, j.jogadorId, { quadraId: q.id, dia: "2026-11-10", inicio: 16 * 60, qtd: 2 }, agora);
  expect(r.ok).toBe(true);
  const p = await periodosPublicos(db, q.id, "2026-11-10");
  expect(p).toEqual([{ inicio: new Date("2026-11-10T16:00:00-03:00"), fim: new Date("2026-11-10T18:00:00-03:00") }]);
  expect(Object.keys(p[0]).sort()).toEqual(["fim", "inicio"]);
  expect(JSON.stringify(p)).not.toMatch(/jogador|ana|@/i);
  expect(await periodosPublicos(db, q.id, "2026-11-11")).toEqual([]);
  expect(await periodosPublicos(db, outra.id, "2026-11-10")).toEqual([]);
  expect(await periodosPublicos(db, "nada", "2026-11-10")).toEqual([]);
});

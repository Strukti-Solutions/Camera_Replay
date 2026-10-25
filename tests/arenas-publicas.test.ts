import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarArena, criarHorariosDeHora, criarQuadra } from "./fixtures";
import {
  arenaPublica, arenasNoMapa, cartoesDeArenas, esportesDasArenas, listarArenasPublicas, periodosPublicos, periodosPublicosEntre, slugDaQuadra, sugestoesArenas,
} from "../app/lib/arenas-publicas";
import { criarContaJogador } from "../app/lib/jogadores";
import { criarReserva } from "../app/lib/reservas";
import { criarHorarios } from "../app/lib/horarios-quadra";
import { reservarFoto, usarComoCapa } from "../app/lib/fotos";
import type { Db } from "../app/lib/db";
import { novoSlug } from "../app/lib/segredos";

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
  expect(Object.keys(r!).sort()).toEqual(["ativa", "endereco", "fotos", "latitude", "longitude", "nome", "quadras", "slug"]);
  expect(Object.keys(r!.endereco!).sort()).toEqual(["bairro", "cep", "cidade", "numero", "rua", "uf"]);
  expect(r!.latitude).toBe(1);
  expect(r!.quadras).toHaveLength(1);
  expect(Object.keys(r!.quadras[0]).sort()).toEqual(["aPartirDe", "capaId", "esporte", "horarios", "id", "nome"]);
  expect(r!.quadras[0].aPartirDe).toBe(4000);
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
  const q = await criarQuadra(db, a.id);
  await reservarFoto(db, a.id, null, "image/webp", 1);
  await reservarFoto(db, a.id, q.id, "image/webp", 1);
  expect((await arenaPublica(db, a.slug))!.fotos).toHaveLength(1);
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [a.id]);
  const r = await arenaPublica(db, a.slug);
  expect(r).toMatchObject({ nome: "Arena X", ativa: false, quadras: [], fotos: [] });
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

test("arenaPublica: fotos da arena em ordem, capa de cada quadra e quadra sem horário", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena F");
  const q = await criarQuadra(db, a.id);
  const f1 = await reservarFoto(db, a.id, null, "image/webp", 1);
  const f2 = await reservarFoto(db, a.id, null, "image/webp", 1);
  const fq = await reservarFoto(db, a.id, q.id, "image/webp", 1);
  if (!f1.ok || !f2.ok || !fq.ok) throw new Error("foto");
  await usarComoCapa(db, a.id, f2.id);
  const r = await arenaPublica(db, a.slug);
  expect(r!.fotos).toEqual([f2.id, f1.id]);
  expect(r!.quadras[0]).toMatchObject({ capaId: fq.id, aPartirDe: null });
});

test("periodosPublicosEntre: períodos que tocam os dias locais do intervalo", async () => {
  const db = await novoBanco();
  const agora = new Date("2026-11-09T10:00:00-03:00");
  const a = await criarArena(db, "Arena P");
  const q = await criarQuadra(db, a.id);
  await criarHorariosDeHora(db, a.id, q.id, [0, 1, 2, 3, 4, 5, 6], 7, 23, 10000);
  const j = await criarContaJogador(db, { nome: "Bia", email: "bia@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!j.ok) throw new Error("conta");
  for (const dia of ["2026-11-10", "2026-11-12"]) {
    const r = await criarReserva(db, j.jogadorId, { quadraId: q.id, dia, inicio: 18 * 60, qtd: 2 }, agora);
    expect(r.ok).toBe(true);
  }
  const p = await periodosPublicosEntre(db, q.id, "2026-11-09", "2026-11-11");
  expect(p).toEqual([{ inicio: new Date("2026-11-10T18:00:00-03:00"), fim: new Date("2026-11-10T20:00:00-03:00") }]);
  expect((await periodosPublicosEntre(db, q.id, "2026-11-09", "2026-11-12")).length).toBe(2);
  const espiao = { query: () => { throw new Error("não devia consultar"); } } as unknown as Db;
  expect(await periodosPublicosEntre(espiao, "nada", "2026-11-09", "2026-11-12")).toEqual([]);
  expect(await periodosPublicosEntre(espiao, q.id, "lixo", "2026-11-12")).toEqual([]);
  expect(await periodosPublicosEntre(db, q.id, "x", "2026-11-12")).toEqual([]);
});

// ---------- Fase 5: cards da home ----------

async function quadraDe(db: Db, arenaId: string, nome: string, esporte: string) {
  const r = await db.query<{ id: string }>(
    "insert into quadras (arena_id, nome, slug, esporte) values ($1, $2, $3, $4) returning id",
    [arenaId, nome, novoSlug(), esporte],
  );
  return r.rows[0].id;
}

test("cartoesDeArenas: foto, bairro, preço mínimo, por hora e esportes", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena Beira-Mar");
  await endereco(db, a.id, { bairro: "Meireles", cidade: "Fortaleza", uf: "CE", lat: -3.72, lng: -38.5 });
  const q1 = await quadraDe(db, a.id, "Q1", "Padel");
  const q2 = await quadraDe(db, a.id, "Q2", "Futevôlei");
  await criarHorariosDeHora(db, a.id, q1, [1], 7, 9, 9000);
  await criarHorariosDeHora(db, a.id, q2, [2], 7, 8, 8000);
  const fa = await reservarFoto(db, a.id, null, "image/webp", 1);
  await reservarFoto(db, a.id, q1, "image/webp", 1); // foto de quadra não entra no card
  const b = await criarArena(db, "Arena Sem Nada");
  const c = await criarArena(db, "Arena Suspensa");
  await quadraDe(db, c.id, "Q", "Padel");
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [c.id]);

  const r = await cartoesDeArenas(db, {});
  expect(r.map((x) => x.nome)).toEqual(["Arena Beira-Mar", "Arena Sem Nada"]);
  expect(r[0]).toEqual({
    nome: "Arena Beira-Mar", slug: a.slug, bairro: "Meireles", cidade: "Fortaleza", latitude: -3.72, longitude: -38.5,
    fotos: [fa.ok ? fa.id : ""], aPartirDe: 8000, porHora: true, esportes: ["Futevôlei", "Padel"],
  });
  expect(r[1]).toMatchObject({ slug: b.slug, fotos: [], aPartirDe: null, porHora: false, esportes: [], latitude: null });
  const json = JSON.stringify(r);
  expect(json).not.toMatch(/taxa|dono|camera/i);
});

test("cartoesDeArenas: duração diferente de 1 h tira o /h; até 5 fotos em ordem", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena X");
  const q = await quadraDe(db, a.id, "Q", "Padel");
  await criarHorarios(db, a.id, q, [
    { diaSemana: 1, inicio: 420, fim: 480, precoCentavos: 5000 },
    { diaSemana: 1, inicio: 930, fim: 1035, precoCentavos: 11000 },
  ]);
  const ids: string[] = [];
  for (let i = 0; i < 7; i++) {
    const f = await reservarFoto(db, a.id, null, "image/webp", 1);
    if (f.ok) ids.push(f.id);
  }
  const [c] = await cartoesDeArenas(db, {});
  expect(c.porHora).toBe(false);
  expect(c.aPartirDe).toBe(5000);
  expect(c.fotos).toEqual(ids.slice(0, 5));
});

test("cartoesDeArenas: busca casa o esporte; filtro de esporte sem acento", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena A");
  await quadraDe(db, a.id, "Q", "Padel");
  const b = await criarArena(db, "Arena B");
  await quadraDe(db, b.id, "Q", "Futevôlei");
  await quadraDe(db, b.id, "Q2", "Beach tennis");
  const nomes = async (f: { busca?: string; esporte?: string }) => (await cartoesDeArenas(db, f)).map((x) => x.nome);
  expect(await nomes({ busca: "padel" })).toEqual(["Arena A"]);
  expect(await nomes({ busca: "FUTEVOLEI" })).toEqual(["Arena B"]);
  expect(await nomes({ esporte: "futevolei" })).toEqual(["Arena B"]);
  expect(await nomes({ esporte: "Padel", busca: "arena" })).toEqual(["Arena A"]);
  expect(await nomes({ esporte: "beach" })).toEqual([]); // filtro é o esporte inteiro
  expect(await nomes({ busca: "%" })).toEqual([]);
  expect(await nomes({ busca: "x'; drop table arenas; --" })).toEqual([]);
});

test("esportesDasArenas: sem repetir, sem vazio, só de arena ativa", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena A");
  await quadraDe(db, a.id, "Q1", "Padel");
  await quadraDe(db, a.id, "Q2", "padel");
  await quadraDe(db, a.id, "Q3", "");
  await quadraDe(db, a.id, "Q4", "Beach tennis");
  const c = await criarArena(db, "Arena C");
  await quadraDe(db, c.id, "Q", "Vôlei");
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [c.id]);
  expect(await esportesDasArenas(db)).toEqual(["Beach tennis", "Padel"]);
});

test("cartoesDeArenas: esporte e nome gravados em NFD casam com busca e filtro", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena Pôr do Sol".normalize("NFD"));
  await quadraDe(db, a.id, "Q", "Vôlei".normalize("NFD"));
  const nomes = async (f: { busca?: string; esporte?: string }) => (await cartoesDeArenas(db, f)).map((x) => x.nome);
  expect(await nomes({ esporte: "volei" })).toHaveLength(1);
  expect(await nomes({ esporte: "Vôlei" })).toHaveLength(1);
  expect(await nomes({ busca: "por do sol" })).toHaveLength(1);
  expect(await nomes({ busca: "VÔLEI" })).toHaveLength(1);
});

test("cartoesDeArenas: bordas do filtro (suspensa, sem quadra, _ literal)", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "Arena A_1");
  await quadraDe(db, a.id, "Q", "Padel");
  const s = await criarArena(db, "Arena Suspensa");
  await quadraDe(db, s.id, "Q", "Padel");
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [s.id]);
  await criarArena(db, "Arena Vazia");
  const nomes = async (f: { busca?: string; esporte?: string }) => (await cartoesDeArenas(db, f)).map((x) => x.nome);
  expect(await nomes({ esporte: "padel" })).toEqual(["Arena A_1"]); // suspensa fica de fora
  expect(await nomes({ busca: "suspensa" })).toEqual([]);
  expect(await nomes({ esporte: "padel", busca: "vazia" })).toEqual([]); // sem quadra não passa no filtro
  expect(await nomes({ busca: "_" })).toEqual(["Arena A_1"]); // _ é texto, não curinga
  expect(await nomes({ busca: "a_1" })).toEqual(["Arena A_1"]);
  expect(await nomes({ busca: "ax1" })).toEqual([]);
});

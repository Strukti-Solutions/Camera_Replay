import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
import type { Db } from "../app/lib/db";
import { decifrarCredenciais } from "../app/lib/cripto";
import { registrarAperto } from "../app/lib/aperto";
import { hashToken } from "../app/lib/segredos";
import {
  ErroPainel, apagarClipe, atualizarCredenciais, cadastrarCamera, clipesDoPainel,
  criarBotao, criarQuadra, definirEsporteQuadra, detalheQuadra, listarQuadras, renomearQuadra, revogarBotao, salvarNomeEsporteQuadra,
} from "../app/lib/painel";
import { reservarFoto, usarComoCapa } from "../app/lib/fotos";
import { novoBanco } from "./db";
import { criarArena, criarBotao as fxBotao, criarCamera, criarQuadra as fxQuadra } from "./fixtures";

const chave = randomBytes(32);
const dadosCam = { nome: "Cam 1", sn: "SN123", authcode: "abc", local_user: "admin", local_pwd: " s3nha " };
const r2Leitor = () => ({ urlLeitura: vi.fn(async (k: string) => `https://r2.exemplo/${k}?assinado`) });
const r2Apagador = () => ({ apagar: vi.fn(async (_k: string) => {}) });

async function duasArenas(db: Db) {
  const a = await criarArena(db, "A");
  const b = await criarArena(db, "B");
  const qa = await fxQuadra(db, a.id);
  const qb = await fxQuadra(db, b.id);
  const ca = await criarCamera(db, a.id, qa.id);
  const cb = await criarCamera(db, b.id, qb.id);
  const ba = await fxBotao(db, a.id, qa.id, ca.id);
  const bb = await fxBotao(db, b.id, qb.id, cb.id);
  return { a, b, qa, qb, ca, cb, ba, bb };
}

async function clipe(
  db: Db, arenaId: string, botaoId: string, cameraId: string,
  o: { status?: string; expiraEmSeg?: number; motivo?: string } = {},
): Promise<string> {
  const ap = await db.query<{ id: string }>(
    "insert into apertos (arena_id, botao_id) values ($1, $2) returning id", [arenaId, botaoId]);
  const r = await db.query<{ id: string }>(
    `insert into clipes (arena_id, aperto_id, camera_id, status, motivo, recebido_em, expira_em)
     values ($1, $2, $3, $4, $5, now(), now() + make_interval(secs => $6)) returning id`,
    [arenaId, ap.rows[0].id, cameraId, o.status ?? "pronto", o.motivo ?? null, o.expiraEmSeg ?? 3600]);
  const id = r.rows[0].id;
  await db.query("update clipes set chave_r2 = $2 where id = $1", [id, `clipes/${arenaId}/${id}.mp4`]);
  return id;
}

// Retrato das linhas de uma arena, para provar que nada nela mudou.
const foto = async (db: Db, arenaId: string) => {
  const out: unknown[] = [];
  for (const n of ["quadras", "cameras", "botoes", "apertos", "clipes"]) {
    out.push((await db.query(`select * from ${n} where arena_id = $1 order by id`, [arenaId])).rows);
  }
  return JSON.stringify(out);
};

test("funções com id de outra arena se comportam como inexistente e não alteram B", async () => {
  const db = await novoBanco();
  const s = await duasArenas(db);
  const c = await clipe(db, s.b.id, s.bb.id, s.cb.id);
  const antes = await foto(db, s.b.id);

  expect(await detalheQuadra(db, s.a.id, s.qb.id)).toBeNull();
  expect(await cadastrarCamera(db, chave, s.a.id, s.qb.id, dadosCam)).toBeNull();
  expect(await atualizarCredenciais(db, chave, s.a.id, s.cb.id, { authcode: "x", local_user: "y", local_pwd: "z" })).toBe(false);
  expect(await criarBotao(db, s.a.id, s.qb.id)).toBeNull();
  expect(await revogarBotao(db, s.a.id, s.bb.id)).toBe(false);
  expect(await clipesDoPainel(db, r2Leitor(), s.a.id, s.qb.id)).toEqual([]);
  const r2 = r2Apagador();
  expect(await apagarClipe(db, r2, s.a.id, c)).toBe(false);
  expect(r2.apagar).not.toHaveBeenCalled();
  expect((await listarQuadras(db, s.a.id)).map((q) => q.id)).toEqual([s.qa.id]);

  expect(await foto(db, s.b.id)).toBe(antes);
});

test("criarQuadra gera slug válido e valida o nome", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id, "  Quadra Central ");
  expect(q.slug).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
  const r = await db.query<{ nome: string }>("select nome from quadras where id = $1", [q.id]);
  expect(r.rows[0].nome).toBe("Quadra Central");
  await expect(criarQuadra(db, a.id, "   ")).rejects.toThrow(ErroPainel);
  await expect(criarQuadra(db, a.id, "x".repeat(61))).rejects.toThrow(ErroPainel);
  await expect(criarQuadra(db, a.id, "x".repeat(60))).resolves.toBeTruthy();
});

test("cadastrarCamera cifra as credenciais e recusa segunda câmera e campos inválidos", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id, "Q");
  const cam = await cadastrarCamera(db, chave, a.id, q.id, dadosCam);
  expect(cam).not.toBeNull();
  const r = await db.query<{ credenciais: string }>("select credenciais from cameras where id = $1", [cam!.id]);
  expect(decifrarCredenciais(r.rows[0].credenciais, chave)).toEqual({
    authcode: "abc", local_user: "admin", local_pwd: " s3nha ",
  });
  await expect(cadastrarCamera(db, chave, a.id, q.id, dadosCam)).rejects.toThrow(ErroPainel);
  const q2 = await criarQuadra(db, a.id, "Q2");
  await expect(cadastrarCamera(db, chave, a.id, q2.id, { ...dadosCam, sn: "   " })).rejects.toThrow(ErroPainel);
  await expect(cadastrarCamera(db, chave, a.id, q2.id, { ...dadosCam, local_pwd: "" })).rejects.toThrow(ErroPainel);
  await expect(cadastrarCamera(db, chave, a.id, q2.id, { ...dadosCam, nome: "x".repeat(201) })).rejects.toThrow(ErroPainel);
});

test("atualizarCredenciais troca as credenciais da câmera da própria arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id, "Q");
  const cam = (await cadastrarCamera(db, chave, a.id, q.id, dadosCam))!;
  expect(await atualizarCredenciais(db, chave, a.id, cam.id, { authcode: "n", local_user: "u", local_pwd: "p" })).toBe(true);
  const r = await db.query<{ credenciais: string }>("select credenciais from cameras where id = $1", [cam.id]);
  expect(decifrarCredenciais(r.rows[0].credenciais, chave)).toEqual({ authcode: "n", local_user: "u", local_pwd: "p" });
});

test("nenhuma função devolve credenciais nem token_hash", async () => {
  const db = await novoBanco();
  const s = await duasArenas(db);
  const lista = await listarQuadras(db, s.a.id);
  const det = await detalheQuadra(db, s.a.id, s.qa.id);
  const proibido = /credenciais|token_hash|tokenHash|local_pwd|authcode/;
  expect(Object.keys(lista[0].camera!).sort()).toEqual(["id", "nome", "online", "sn", "vistoEm"]);
  expect(Object.keys(det!.camera!).sort()).toEqual(["id", "nome", "online", "sn", "vistoEm"]);
  expect(Object.keys(det!.botoes[0]).sort()).toEqual(["criadoEm", "id", "revogadoEm", "vistoEm"]);
  expect(JSON.stringify(det)).not.toMatch(proibido);
  expect(JSON.stringify(lista)).not.toMatch(proibido);
});

test("online depende de status e de visto_em recente", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await fxQuadra(db, a.id);
  const cam = await criarCamera(db, a.id, q.id);
  const online = async (status: string, seg: number) => {
    await db.query(
      "update cameras set status = $2, visto_em = now() - make_interval(secs => $3) where id = $1",
      [cam.id, status, seg]);
    return (await detalheQuadra(db, a.id, q.id))!.camera!.online;
  };
  expect(await online("online", 30)).toBe(true);
  expect(await online("online", 90)).toBe(false);
  expect(await online("offline", 30)).toBe(false);
  await db.query("update cameras set status = 'online', visto_em = null where id = $1", [cam.id]);
  expect((await detalheQuadra(db, a.id, q.id))!.camera!.online).toBe(false);
});

test("a câmera da quadra é a mais recente e botoesAtivos ignora revogados", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await fxQuadra(db, a.id);
  const velha = await criarCamera(db, a.id, q.id);
  await db.query("update cameras set criado_em = now() - interval '1 day' where id = $1", [velha.id]);
  const nova = await criarCamera(db, a.id, q.id);
  const b1 = await fxBotao(db, a.id, q.id, nova.id);
  await fxBotao(db, a.id, q.id, nova.id);
  await db.query("update botoes set revogado_em = now() where id = $1", [b1.id]);
  const det = (await detalheQuadra(db, a.id, q.id))!;
  expect(det.camera!.id).toBe(nova.id);
  expect(det.botoes).toHaveLength(2);
  expect((await listarQuadras(db, a.id))[0].botoesAtivos).toBe(1);
});

test("criarBotao devolve token cujo hash está no banco; revogar bloqueia o aperto", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q = await criarQuadra(db, a.id, "Q");
  await expect(criarBotao(db, a.id, q.id)).rejects.toThrow(ErroPainel);
  await cadastrarCamera(db, chave, a.id, q.id, dadosCam);
  const b = (await criarBotao(db, a.id, q.id))!;
  const r = await db.query("select id from botoes where token_hash = $1", [hashToken(b.token)]);
  expect(r.rows[0].id).toBe(b.id);
  expect(await registrarAperto(db, b.token)).not.toBeNull();
  expect(await revogarBotao(db, a.id, b.id)).toBe(true);
  expect(await revogarBotao(db, a.id, b.id)).toBe(false);
  expect(await registrarAperto(db, b.token)).toBeNull();
});

test("clipesDoPainel traz todos os status, url só em pronto/parcial, sem expirados", async () => {
  const db = await novoBanco();
  const s = await duasArenas(db);
  for (const st of ["pendente", "processando", "pronto", "parcial", "falhou"]) {
    await clipe(db, s.a.id, s.ba.id, s.ca.id, { status: st, motivo: st === "falhou" ? "câmera offline" : undefined });
  }
  await clipe(db, s.a.id, s.ba.id, s.ca.id, { expiraEmSeg: -10 });
  const lista = await clipesDoPainel(db, r2Leitor(), s.a.id, s.qa.id);
  expect(lista).toHaveLength(5);
  for (const c of lista) {
    expect(c.url !== null).toBe(c.status === "pronto" || c.status === "parcial");
  }
  expect(lista.find((c) => c.status === "falhou")!.motivo).toBe("câmera offline");
});

test("apagarClipe apaga no R2 e depois a linha; recusa em andamento; erro do R2 mantém a linha", async () => {
  const db = await novoBanco();
  const s = await duasArenas(db);
  const pronto = await clipe(db, s.a.id, s.ba.id, s.ca.id);
  const proc = await clipe(db, s.a.id, s.ba.id, s.ca.id, { status: "processando" });
  const pend = await clipe(db, s.a.id, s.ba.id, s.ca.id, { status: "pendente" });
  const existe = async (id: string) => (await db.query("select 1 from clipes where id = $1", [id])).rows.length === 1;

  const r2 = r2Apagador();
  expect(await apagarClipe(db, r2, s.a.id, proc)).toBe(false);
  expect(await apagarClipe(db, r2, s.a.id, pend)).toBe(false);
  expect(r2.apagar).not.toHaveBeenCalled();

  const ruim = { apagar: vi.fn(async () => { throw new Error("r2 fora"); }) };
  await expect(apagarClipe(db, ruim, s.a.id, pronto)).rejects.toThrow("r2 fora");
  expect(await existe(pronto)).toBe(true);

  expect(await apagarClipe(db, r2, s.a.id, pronto)).toBe(true);
  expect(r2.apagar.mock.calls.map((c) => c[0])).toEqual([
    `clipes/${s.a.id}/${pronto}.mp4`,
    `clipes/${s.a.id}/${pronto}.jpg`,
  ]);
  expect(await existe(pronto)).toBe(false);
  expect(await apagarClipe(db, r2, s.a.id, pronto)).toBe(false);
});

test("id malformado vale como inexistente, sem exceção e sem ir ao banco", async () => {
  const db = await novoBanco();
  const s = await duasArenas(db);
  const consulta = vi.spyOn(db, "query");
  const r2 = r2Apagador();
  const cred = { authcode: "x", local_user: "y", local_pwd: "z" };
  for (const ruim of ["abc", "' or 1=1 --"]) {
    expect(await listarQuadras(db, ruim)).toEqual([]);
    expect(await detalheQuadra(db, s.a.id, ruim)).toBeNull();
    expect(await detalheQuadra(db, ruim, s.qa.id)).toBeNull();
    expect(await cadastrarCamera(db, chave, s.a.id, ruim, dadosCam)).toBeNull();
    expect(await cadastrarCamera(db, chave, ruim, s.qa.id, dadosCam)).toBeNull();
    expect(await atualizarCredenciais(db, chave, s.a.id, ruim, cred)).toBe(false);
    expect(await atualizarCredenciais(db, chave, ruim, s.ca.id, cred)).toBe(false);
    expect(await criarBotao(db, s.a.id, ruim)).toBeNull();
    expect(await criarBotao(db, ruim, s.qa.id)).toBeNull();
    expect(await revogarBotao(db, s.a.id, ruim)).toBe(false);
    expect(await revogarBotao(db, ruim, s.ba.id)).toBe(false);
    expect(await clipesDoPainel(db, r2Leitor(), s.a.id, ruim)).toEqual([]);
    expect(await clipesDoPainel(db, r2Leitor(), ruim, s.qa.id)).toEqual([]);
    expect(await apagarClipe(db, r2, s.a.id, ruim)).toBe(false);
    expect(await apagarClipe(db, r2, ruim, s.ba.id)).toBe(false);
    await expect(criarQuadra(db, ruim, "Q")).rejects.toThrow(ErroPainel);
  }
  expect(consulta).not.toHaveBeenCalled();
  expect(r2.apagar).not.toHaveBeenCalled();
});

test("apagarClipe: chave_r2 divergente lança sem tocar no R2 e mantém a linha", async () => {
  const db = await novoBanco();
  const s = await duasArenas(db);
  const id = await clipe(db, s.a.id, s.ba.id, s.ca.id);
  await db.query("update clipes set chave_r2 = 'clipes/outra/coisa.mp4' where id = $1", [id]);
  const r2 = r2Apagador();
  await expect(apagarClipe(db, r2, s.a.id, id)).rejects.toThrow(ErroPainel);
  expect(r2.apagar).not.toHaveBeenCalled();
  expect((await db.query("select 1 from clipes where id = $1", [id])).rows).toHaveLength(1);
});

test("apagarClipe: falhou sem chave_r2 apaga a linha sem chamar o R2", async () => {
  const db = await novoBanco();
  const s = await duasArenas(db);
  const id = await clipe(db, s.a.id, s.ba.id, s.ca.id, { status: "falhou", motivo: "x" });
  await db.query("update clipes set chave_r2 = null where id = $1", [id]);
  const r2 = r2Apagador();
  expect(await apagarClipe(db, r2, s.a.id, id)).toBe(true);
  expect(r2.apagar).not.toHaveBeenCalled();
  expect((await db.query("select 1 from clipes where id = $1", [id])).rows).toHaveLength(0);
});


test("renomearQuadra valida 1–60 e não toca quadra de outra arena", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const b = await criarArena(db, "Outra");
  const q = await criarQuadra(db, a.id, "Antiga");
  const nome = async () => (await db.query<{ nome: string }>("select nome from quadras where id = $1", [q.id])).rows[0].nome;
  expect(await renomearQuadra(db, a.id, q.id, "  Nova  ")).toBe(true);
  expect(await nome()).toBe("Nova");
  await expect(renomearQuadra(db, a.id, q.id, "   ")).rejects.toThrow(ErroPainel);
  await expect(renomearQuadra(db, a.id, q.id, "x".repeat(61))).rejects.toThrow(ErroPainel);
  expect(await renomearQuadra(db, a.id, q.id, "x".repeat(60))).toBe(true);
  expect(await renomearQuadra(db, b.id, q.id, "Invasor")).toBe(false);
  expect(await nome()).toBe("x".repeat(60));
  expect(await renomearQuadra(db, a.id, "malformado", "N")).toBe(false);
  expect(await renomearQuadra(db, "malformado", q.id, "N")).toBe(false);
});

test("salvarNomeEsporteQuadra grava os dois ou nenhum", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const b = await criarArena(db, "Outra");
  const q = await criarQuadra(db, a.id, "Antiga");
  const linha = async () => (await db.query<{ nome: string; esporte: string }>("select nome, esporte from quadras where id = $1", [q.id])).rows[0];
  expect(await salvarNomeEsporteQuadra(db, a.id, q.id, "  Nova ", " Vôlei ")).toEqual({ ok: true });
  expect(await linha()).toEqual({ nome: "Nova", esporte: "Vôlei" });
  expect(await salvarNomeEsporteQuadra(db, a.id, q.id, "Outra", "x".repeat(41))).toEqual({ ok: false, erro: "esporte" });
  expect(await salvarNomeEsporteQuadra(db, a.id, q.id, " ", "")).toEqual({ ok: false, erro: "nome" });
  expect(await salvarNomeEsporteQuadra(db, a.id, q.id, "x".repeat(61), "")).toEqual({ ok: false, erro: "nome" });
  expect(await linha()).toEqual({ nome: "Nova", esporte: "Vôlei" });
  expect(await salvarNomeEsporteQuadra(db, b.id, q.id, "Invasor", "Gol")).toEqual({ ok: false, erro: "quadra" });
  expect(await salvarNomeEsporteQuadra(db, a.id, "malformado", "N", "")).toEqual({ ok: false, erro: "quadra" });
  expect(await linha()).toEqual({ nome: "Nova", esporte: "Vôlei" });
});

test("definirEsporteQuadra: apara, limita a 40, recusa quadra de outra arena e aceita vazio", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A"), b = await criarArena(db, "B");
  const qa = await fxQuadra(db, a.id), qb = await fxQuadra(db, b.id);
  expect(await definirEsporteQuadra(db, a.id, qa.id, " Beach tennis ")).toBe(true);
  const esporte = async (id: string) =>
    (await db.query<{ esporte: string }>("select esporte from quadras where id = $1", [id])).rows[0].esporte;
  expect(await esporte(qa.id)).toBe("Beach tennis");
  expect(await definirEsporteQuadra(db, a.id, qa.id, "x".repeat(41))).toBe(false);
  expect(await esporte(qa.id)).toBe("Beach tennis");
  expect(await definirEsporteQuadra(db, a.id, qb.id, "Futevôlei")).toBe(false);
  expect(await esporte(qb.id)).toBe("");
  expect(await definirEsporteQuadra(db, a.id, qa.id, "   ")).toBe(true);
  expect(await esporte(qa.id)).toBe("");
});

test("lista de quadras traz o esporte e a capa (posição 0) de cada quadra", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const q1 = await fxQuadra(db, a.id);
  const q2 = await fxQuadra(db, a.id);
  await db.query("update quadras set nome = 'Zeta', esporte = 'Padel' where id = $1", [q2.id]);
  const f1 = await reservarFoto(db, a.id, q1.id, "image/webp", 1);
  const f2 = await reservarFoto(db, a.id, q1.id, "image/webp", 1);
  await reservarFoto(db, a.id, null, "image/webp", 1); // foto da arena não é capa de quadra
  if (!f1.ok || !f2.ok) throw new Error("foto");
  await usarComoCapa(db, a.id, f2.id);
  const lista = await listarQuadras(db, a.id);
  expect(lista.map((q) => [q.id, q.esporte, q.capaId])).toEqual([[q1.id, "", f2.id], [q2.id, "Padel", null]]);
});

test("listarQuadras: contagem de fotos, menor preço e se é tudo por hora", async () => {
  const db = await novoBanco();
  const a = await criarArena(db, "A");
  const q1 = await fxQuadra(db, a.id);
  const q2 = await fxQuadra(db, a.id);
  const outra = await criarArena(db, "B");
  const qb = await fxQuadra(db, outra.id);
  await reservarFoto(db, a.id, q1.id, "image/webp", 1);
  await reservarFoto(db, a.id, q1.id, "image/webp", 1);
  await reservarFoto(db, a.id, null, "image/webp", 1); // foto da arena não conta na quadra
  await reservarFoto(db, outra.id, qb.id, "image/webp", 1);
  const hq = "insert into horarios_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos) values ($1,$2,$3,$4,$5,$6)";
  await db.query(hq, [a.id, q1.id, 1, 420, 480, 9000]);
  await db.query(hq, [a.id, q1.id, 2, 480, 540, 8000]);
  await db.query(hq, [a.id, q2.id, 1, 930, 1035, 15000]); // 1h45: não é por hora
  await db.query(hq, [outra.id, qb.id, 1, 420, 480, 100]);
  const lista = await listarQuadras(db, a.id);
  const p = (id: string) => lista.find((q) => q.id === id)!;
  expect(p(q1.id)).toMatchObject({ fotos: 2, aPartirDe: 8000, porHora: true });
  expect(p(q2.id)).toMatchObject({ fotos: 0, aPartirDe: 15000, porHora: false });
  const sem = await fxQuadra(db, a.id);
  expect((await listarQuadras(db, a.id)).find((q) => q.id === sem.id)).toMatchObject({ fotos: 0, aPartirDe: null, porHora: false });
});

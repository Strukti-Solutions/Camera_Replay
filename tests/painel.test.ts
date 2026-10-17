import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
import type { Db } from "../app/lib/db";
import { decifrarCredenciais } from "../app/lib/cripto";
import { registrarAperto } from "../app/lib/aperto";
import { hashToken } from "../app/lib/segredos";
import {
  ErroPainel, apagarClipe, atualizarCredenciais, cadastrarCamera, clipesDoPainel,
  criarBotao, criarQuadra, detalheQuadra, listarQuadras, revogarBotao,
} from "../app/lib/painel";
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
  expect(r2.apagar).toHaveBeenCalledWith(`clipes/${s.a.id}/${pronto}.mp4`);
  expect(await existe(pronto)).toBe(false);
  expect(await apagarClipe(db, r2, s.a.id, pronto)).toBe(false);
});

import { expect, test, vi } from "vitest";
import type { Db } from "../app/lib/db";
import { criarAluno, removerAluno } from "../app/lib/alunos";
import { criarReserva, definirAlunosDaReserva } from "../app/lib/reservas";
import { atribuirClipe } from "../app/lib/painel";
import { entrar, validarSessao } from "../app/lib/sessao";
import {
  entrarAluno, lancesAvulsosDoAluno, lancesDaReserva, reservasPublicas, sairAluno, validarSessaoAluno,
} from "../app/lib/acesso-aluno";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";
import { hashSenha } from "../app/lib/senha";

const SENHA = "senha-boa-1";
const h = (hora: number, min = 0) => new Date(Date.UTC(2026, 9, 17, hora, min));
const r2Falso = () => ({
  urlLeitura: vi.fn(async (k: string, o?: { baixarComo?: string }) =>
    `https://r2.exemplo/${k}?assinado${o?.baixarComo ? `&baixarComo=${o.baixarComo}` : ""}`),
});

async function cenario(db: Db) {
  const a = await criarArena(db, "Arena A"), b = await criarArena(db, "Arena B");
  const qa = await criarQuadra(db, a.id), qa2 = await criarQuadra(db, a.id), qb = await criarQuadra(db, b.id);
  const ca = await criarCamera(db, a.id, qa.id), ca2 = await criarCamera(db, a.id, qa2.id);
  const ana = await criarAluno(db, a.id, { nome: "Ana Souza Lima", email: "ana@x.com", senha: SENHA });
  const beto = await criarAluno(db, a.id, { nome: "Beto Lima", email: "beto@x.com", senha: SENHA });
  const anaB = await criarAluno(db, b.id, { nome: "Ana de B", email: "ana@x.com", senha: SENHA });
  return { a, b, qa, qa2, qb, ca, ca2, ana, beto, anaB };
}

// Clipe da câmera com recebido_em fixo; devolve o id.
async function clipeEm(
  db: Db, arenaId: string, quadraId: string, cameraId: string, quando: Date,
  o: { status?: string; expiraEmSeg?: number } = {},
): Promise<string> {
  const bt = await criarBotao(db, arenaId, quadraId, cameraId);
  const ap = await db.query<{ id: string }>(
    "insert into apertos (arena_id, botao_id) values ($1,$2) returning id", [arenaId, bt.id]);
  const r = await db.query<{ id: string }>(
    `insert into clipes (arena_id, aperto_id, camera_id, status, recebido_em, expira_em)
     values ($1,$2,$3,$4,$5, now() + make_interval(secs => $6)) returning id`,
    [arenaId, ap.rows[0].id, cameraId, o.status ?? "pronto", quando, o.expiraEmSeg ?? 3600]);
  const id = r.rows[0].id;
  await db.query("update clipes set chave_r2 = $2 where id = $1", [id, `clipes/${arenaId}/${id}.mp4`]);
  return id;
}

test("aluno da reserva vê os lances dela; lance 1 min depois do fim e exatamente no fim ficam de fora", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(8), fim: h(10), alunoIds: [s.ana.id] }))!;
  const noInicio = await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(8));
  const dentro = await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(9));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(10)); // exatamente no fim: semiaberto, fora
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(10, 1));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(7, 59));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(9, 30), { status: "falhou" });
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(9, 31), { expiraEmSeg: -5 });
  await clipeEm(db, s.a.id, s.qa2.id, s.ca2.id, h(9)); // outra quadra

  const v = await lancesDaReserva(db, r2Falso(), s.qa.slug, r.id, s.ana.id);
  expect(v?.reserva).toEqual({ inicio: h(8), fim: h(10) });
  expect(v?.clipes.map((c) => c.id)).toEqual([dentro, noInicio]);
  expect(v?.clipes[0].capa).toMatch(/\.jpg\?/);
  expect(v?.clipes[0].download).toMatch(/baixarComo=lance-2026-10-17-06h00\.mp4/);
});

test("aluno fora da reserva, slug de outra quadra e id malformado dão null", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(8), fim: h(10), alunoIds: [s.ana.id] }))!;
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(9));
  expect(await lancesDaReserva(db, r2Falso(), s.qa.slug, r.id, s.beto.id)).toBeNull();
  expect(await lancesDaReserva(db, r2Falso(), s.qa2.slug, r.id, s.ana.id)).toBeNull();
  expect(await lancesDaReserva(db, r2Falso(), s.qb.slug, r.id, s.ana.id)).toBeNull();
  expect(await lancesDaReserva(db, r2Falso(), s.qa.slug, "x", s.ana.id)).toBeNull();
  expect(await lancesDaReserva(db, r2Falso(), "curto", r.id, s.ana.id)).toBeNull();
  // aluno de outra arena com o mesmo e-mail não enxerga
  expect(await lancesDaReserva(db, r2Falso(), s.qa.slug, r.id, s.anaB.id)).toBeNull();
});

test("lance avulso atribuído aparece só para o aluno atribuído, na quadra certa", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const c = await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(15));
  const outraQuadra = await clipeEm(db, s.a.id, s.qa2.id, s.ca2.id, h(15));
  const expirado = await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(16), { expiraEmSeg: -5 });
  for (const id of [c, outraQuadra, expirado]) expect(await atribuirClipe(db, s.a.id, id, [s.ana.id])).toBe(true);

  expect((await lancesAvulsosDoAluno(db, r2Falso(), s.qa.slug, s.ana.id)).map((x) => x.id)).toEqual([c]);
  expect(await lancesAvulsosDoAluno(db, r2Falso(), s.qa.slug, s.beto.id)).toEqual([]);
  expect(await lancesAvulsosDoAluno(db, r2Falso(), s.qb.slug, s.ana.id)).toEqual([]);
  expect(await lancesAvulsosDoAluno(db, r2Falso(), s.qa.slug, s.anaB.id)).toEqual([]);
});

test("reservasPublicas: só primeiro nome, sem e-mail, omite reserva sem lance, sem aluno e fora da retenção", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r1 = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(8), fim: h(10), alunoIds: [s.ana.id, s.beto.id] }))!;
  const vazia = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(11), fim: h(12), alunoIds: [s.ana.id] }))!;
  const semAluno = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(13), fim: h(14), alunoIds: [s.ana.id] }))!;
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(8, 30));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(9));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(13, 30));
  // a última aluna da reserva sai: a reserva some da lista pública
  await definirAlunosDaReserva(db, s.a.id, semAluno.id, [s.beto.id]);
  await removerAluno(db, s.a.id, s.beto.id);

  const p = await reservasPublicas(db, s.qa.slug);
  expect(p?.quadra).toBe("Quadra 1");
  expect(p?.reservas.map((x) => x.id)).toEqual([r1.id]);
  expect(p?.reservas[0]).toMatchObject({ lances: 2, primeirosNomes: ["Ana"] });
  expect(p?.reservas.find((x) => x.id === vazia.id)).toBeUndefined();
  const texto = JSON.stringify(p);
  for (const proibido of ["Souza", "Lima", "@", "ana@x.com"]) expect(texto).not.toContain(proibido);
});

test("reservasPublicas: mais nova primeiro, janela de retenção e slug inválido/desconhecido", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const antiga = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(1), fim: h(2), alunoIds: [s.ana.id] }))!;
  const nova = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(3), fim: h(4), alunoIds: [s.ana.id] }))!;
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(1, 30));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(3, 30));
  expect((await reservasPublicas(db, s.qa.slug))!.reservas.map((x) => x.id)).toEqual([nova.id, antiga.id]);

  // reserva que terminou há mais que dias_retencao (7) não entra
  await db.query("update reservas set inicio = now() - interval '9 days', fim = now() - interval '9 days' + interval '1 hour' where id = $1", [antiga.id]);
  expect((await reservasPublicas(db, s.qa.slug))!.reservas.map((x) => x.id)).toEqual([nova.id]);

  expect(await reservasPublicas(db, "A".repeat(22))).toBeNull();
  expect(await reservasPublicas(db, "../x")).toBeNull();
});

test("reservasPublicas não mistura reservas de outra quadra", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  await criarReserva(db, s.a.id, { quadraId: s.qa2.id, inicio: h(8), fim: h(10), alunoIds: [s.ana.id] });
  await clipeEm(db, s.a.id, s.qa2.id, s.ca2.id, h(9));
  expect((await reservasPublicas(db, s.qa.slug))!.reservas).toEqual([]);
  expect((await reservasPublicas(db, s.qa2.slug))!.reservas).toHaveLength(1);
});

test("login do aluno: entra, valida, sai; e-mail normalizado; mesma resposta para erro", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r = await entrarAluno(db, s.qa.slug, " ANA@x.com ", SENHA, "1.1.1.1");
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(await validarSessaoAluno(db, r.token)).toMatchObject({ alunoId: s.ana.id, arenaId: s.a.id, nome: "Ana Souza Lima" });
  await sairAluno(db, r.token);
  expect(await validarSessaoAluno(db, r.token)).toBeNull();

  const errada = await entrarAluno(db, s.qa.slug, "ana@x.com", "errada-123", "1.1.1.1");
  const inexistente = await entrarAluno(db, s.qa.slug, "nao@x.com", "errada-123", "1.1.1.1");
  const slugRuim = await entrarAluno(db, "A".repeat(22), "ana@x.com", SENHA, "1.1.1.1");
  expect(errada).toEqual({ ok: false, motivo: "credenciais" });
  expect(inexistente).toEqual(errada);
  expect(slugRuim).toEqual(errada);
});

test("aluno de outra arena com o mesmo e-mail é outra conta e não entra pelo slug desta", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  await db.query("update alunos set senha_hash = $2 where id = $1", [s.anaB.id, await hashSenha("outra-senha-9")]);
  expect((await entrarAluno(db, s.qa.slug, "ana@x.com", "outra-senha-9", "1.1.1.1")).ok).toBe(false);
  const ok = await entrarAluno(db, s.qb.slug, "ana@x.com", "outra-senha-9", "1.1.1.1");
  expect(ok.ok).toBe(true);
  if (ok.ok) expect((await validarSessaoAluno(db, ok.token))?.arenaId).toBe(s.b.id);
});

test("5 falhas bloqueiam o aluno, mesmo com a senha certa", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  for (let i = 0; i < 5; i++) await entrarAluno(db, s.qa.slug, "ana@x.com", "errada-123", "2.2.2.2");
  expect(await entrarAluno(db, s.qa.slug, "ana@x.com", SENHA, "3.3.3.3")).toEqual({ ok: false, motivo: "bloqueado" });
});

test("sessão de aluno não vale como sessão de dono e vice-versa", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  await db.query(
    "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'dono@x.com', $2, 'dono')",
    [s.a.id, await hashSenha(SENHA)]);
  const al = await entrarAluno(db, s.qa.slug, "ana@x.com", SENHA, "1.1.1.1");
  const dono = await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  if (!al.ok || !dono.ok) throw new Error("login falhou");
  expect(await validarSessao(db, al.token)).toBeNull();
  expect(await validarSessaoAluno(db, dono.token)).toBeNull();
  expect(await validarSessaoAluno(db, "lixo")).toBeNull();
});

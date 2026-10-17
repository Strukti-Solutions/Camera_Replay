import { expect, test, vi } from "vitest";
import type { Db } from "../app/lib/db";
import { criarAluno, listarAlunos, removerAluno } from "../app/lib/alunos";
import { criarReserva, definirAlunosDaReserva } from "../app/lib/reservas";
import { atribuirClipe } from "../app/lib/painel";
import { entrar, validarSessao } from "../app/lib/sessao";
import {
  arenaDoSlug, entrarAluno, lancesAvulsosDoAluno, lancesDaReserva, reservasDoAluno, sairAluno, slugDaArena, slugDaArenaDaQuadra, validarSessaoAluno,
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

  const v = await lancesDaReserva(db, r2Falso(), s.a.slug, r.id, s.ana.id);
  expect(v?.reserva).toEqual({ inicio: h(8), fim: h(10), quadra: "Quadra 1" });
  expect(v?.clipes.map((c) => c.id)).toEqual([dentro, noInicio]);
  expect(v?.clipes[0].capa).toMatch(/\.jpg\?/);
  expect(v?.clipes[0].download).toMatch(/baixarComo=lance-2026-10-17-06h00\.mp4/);
});

test("aluno fora da reserva, reserva de outra arena e id malformado dão null", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(8), fim: h(10), alunoIds: [s.ana.id] }))!;
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(9));
  expect(await lancesDaReserva(db, r2Falso(), s.a.slug, r.id, s.beto.id)).toBeNull();
  // reserva de outra arena por id: null, mesmo com slug e aluno de outra arena
  expect(await lancesDaReserva(db, r2Falso(), s.b.slug, r.id, s.ana.id)).toBeNull();
  expect(await lancesDaReserva(db, r2Falso(), s.b.slug, r.id, s.anaB.id)).toBeNull();
  expect(await lancesDaReserva(db, r2Falso(), s.a.slug, "x", s.ana.id)).toBeNull();
  expect(await lancesDaReserva(db, r2Falso(), "curto", r.id, s.ana.id)).toBeNull();
  // aluno de outra arena com o mesmo e-mail não enxerga
  expect(await lancesDaReserva(db, r2Falso(), s.a.slug, r.id, s.anaB.id)).toBeNull();
});

test("lance avulso atribuído aparece só para o aluno atribuído, em todas as quadras da arena", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const c = await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(15));
  const outraQuadra = await clipeEm(db, s.a.id, s.qa2.id, s.ca2.id, h(15, 5));
  const expirado = await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(16), { expiraEmSeg: -5 });
  for (const id of [c, outraQuadra, expirado]) expect(await atribuirClipe(db, s.a.id, id, [s.ana.id])).toBe(true);

  // vale para todas as quadras da arena; o expirado fica de fora
  expect((await lancesAvulsosDoAluno(db, r2Falso(), s.a.slug, s.ana.id)).map((x) => x.id)).toEqual([outraQuadra, c]);
  expect(await lancesAvulsosDoAluno(db, r2Falso(), s.a.slug, s.beto.id)).toEqual([]);
  expect(await lancesAvulsosDoAluno(db, r2Falso(), s.b.slug, s.ana.id)).toEqual([]);
  expect(await lancesAvulsosDoAluno(db, r2Falso(), s.a.slug, s.anaB.id)).toEqual([]);
});

test("login do aluno: entra, valida, sai; e-mail normalizado; mesma resposta para erro", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const r = await entrarAluno(db, s.a.slug, " ANA@x.com ", SENHA, "1.1.1.1");
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(await validarSessaoAluno(db, r.token)).toMatchObject({ alunoId: s.ana.id, arenaId: s.a.id, nome: "Ana Souza Lima" });
  await sairAluno(db, r.token);
  expect(await validarSessaoAluno(db, r.token)).toBeNull();

  const errada = await entrarAluno(db, s.a.slug, "ana@x.com", "errada-123", "1.1.1.1");
  const inexistente = await entrarAluno(db, s.a.slug, "nao@x.com", "errada-123", "1.1.1.1");
  const slugRuim = await entrarAluno(db, "A".repeat(22), "ana@x.com", SENHA, "1.1.1.1");
  expect(errada).toEqual({ ok: false, motivo: "credenciais" });
  expect(inexistente).toEqual(errada);
  expect(slugRuim).toEqual(errada);
});

test("aluno de outra arena com o mesmo e-mail é outra conta e não entra pelo slug desta", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  await db.query("update alunos set senha_hash = $2 where id = $1", [s.anaB.id, await hashSenha("outra-senha-9")]);
  expect((await entrarAluno(db, s.a.slug, "ana@x.com", "outra-senha-9", "1.1.1.1")).ok).toBe(false);
  const ok = await entrarAluno(db, s.b.slug, "ana@x.com", "outra-senha-9", "1.1.1.1");
  expect(ok.ok).toBe(true);
  if (ok.ok) expect((await validarSessaoAluno(db, ok.token))?.arenaId).toBe(s.b.id);
});

test("5 falhas bloqueiam o aluno, mesmo com a senha certa", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  for (let i = 0; i < 5; i++) await entrarAluno(db, s.a.slug, "ana@x.com", "errada-123", "2.2.2.2");
  expect(await entrarAluno(db, s.a.slug, "ana@x.com", SENHA, "3.3.3.3")).toEqual({ ok: false, motivo: "bloqueado" });
});

test("sessão de aluno não vale como sessão de dono e vice-versa", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  await db.query(
    "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'dono@x.com', $2, 'dono')",
    [s.a.id, await hashSenha(SENHA)]);
  const al = await entrarAluno(db, s.a.slug, "ana@x.com", SENHA, "1.1.1.1");
  const dono = await entrar(db, "dono@x.com", SENHA, "1.1.1.1");
  if (!al.ok || !dono.ok) throw new Error("login falhou");
  expect(await validarSessao(db, al.token)).toBeNull();
  expect(await validarSessaoAluno(db, dono.token)).toBeNull();
  expect(await validarSessaoAluno(db, "lixo")).toBeNull();
});

test("sucesso do aluno em outra arena não zera as falhas do dono com o mesmo e-mail", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  // dono da arena A e aluno da arena B com o mesmo e-mail e senha conhecida
  await db.query(
    "insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'ana@x.com', $2, 'dono')",
    [s.a.id, await hashSenha("senha-do-dono-1")]);
  for (let i = 0; i < 5; i++) expect((await entrar(db, "ana@x.com", "errada-123", "4.4.4.4")).ok).toBe(false);
  expect((await entrarAluno(db, s.b.slug, "ana@x.com", SENHA, "5.5.5.5")).ok).toBe(true);
  expect(await entrar(db, "ana@x.com", "senha-do-dono-1", "6.6.6.6")).toEqual({ ok: false, motivo: "bloqueado" });
});

test("sucesso do aluno em uma arena não zera as falhas do mesmo e-mail em outra arena", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  for (let i = 0; i < 5; i++) await entrarAluno(db, s.a.slug, "ana@x.com", "errada-123", "4.4.4.4");
  expect((await entrarAluno(db, s.b.slug, "ana@x.com", SENHA, "5.5.5.5")).ok).toBe(true);
  expect(await entrarAluno(db, s.a.slug, "ana@x.com", SENHA, "6.6.6.6")).toEqual({ ok: false, motivo: "bloqueado" });
});

test("chave de tentativa por conta: aluno:<arena>:<email>, slug desconhecido usa ?", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  await entrarAluno(db, s.a.slug, "ana@x.com", "errada-123", "1.1.1.1");
  await entrarAluno(db, "A".repeat(22), "ana@x.com", "errada-123", "1.1.1.1");
  const r = await db.query<{ email: string }>("select email from tentativas_login order by id");
  expect(r.rows.map((x) => x.email)).toEqual([`aluno:${s.a.id}:ana@x.com`, "aluno:?:ana@x.com"]);
});

test("criarAluno normaliza tab e espaço não separável do nome", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const novo = await criarAluno(db, s.a.id, { nome: "Caio\u00a0\tMota", email: "caio@x.com", senha: SENHA });
  const n = await db.query<{ nome: string }>("select nome from alunos where id = $1", [novo.id]);
  expect(n.rows[0].nome).toBe("Caio Mota");
});

test("reservasDoAluno: só as reservas do aluno, sem as de outro aluno, sem lance ou de outra quadra/arena", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  await db.query("update quadras set nome = 'Quadra 2' where id = $1", [s.qa2.id]);
  const minha = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(8), fim: h(10), alunoIds: [s.ana.id, s.beto.id] }))!;
  const doBeto = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(11), fim: h(12), alunoIds: [s.beto.id] }))!;
  const semLance = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(13), fim: h(14), alunoIds: [s.ana.id] }))!;
  const outraQuadra = (await criarReserva(db, s.a.id, { quadraId: s.qa2.id, inicio: h(15), fim: h(16), alunoIds: [s.ana.id] }))!;
  const deOutraArena = (await criarReserva(db, s.b.id, { quadraId: s.qb.id, inicio: h(8), fim: h(10), alunoIds: [s.anaB.id] }))!;
  await clipeEm(db, s.b.id, s.qb.id, (await criarCamera(db, s.b.id, s.qb.id)).id, h(9));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(8, 30));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(9));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(11, 30));
  await clipeEm(db, s.a.id, s.qa2.id, s.ca2.id, h(15, 30));

  const p = await reservasDoAluno(db, s.a.slug, s.ana.id);
  expect(p?.arenaId).toBe(s.a.id);
  // as duas quadras da arena, cada reserva com o nome da quadra; mais nova primeiro
  expect(p?.reservas.map((x) => [x.id, x.quadra])).toEqual([[outraQuadra.id, "Quadra 2"], [minha.id, "Quadra 1"]]);
  expect(p?.reservas.map((x) => x.lances)).toEqual([1, 2]);
  const ids = p!.reservas.map((x) => x.id);
  for (const fora of [doBeto.id, semLance.id, deOutraArena.id]) expect(ids).not.toContain(fora);
  // nenhum campo de nome nem de e-mail, de ninguém
  expect(Object.keys(p!.reservas[0]).sort()).toEqual(["fim", "id", "inicio", "lances", "quadra"]);
  const texto = JSON.stringify(p);
  for (const proibido of ["Ana", "Beto", "Souza", "Lima", "@"]) expect(texto).not.toContain(proibido);

  expect((await reservasDoAluno(db, s.a.slug, s.beto.id))!.reservas.map((x) => x.id)).toEqual([doBeto.id, minha.id]);
  // aluno de outra arena com mesmo e-mail, id malformado: nada
  expect((await reservasDoAluno(db, s.a.slug, s.anaB.id))!.reservas).toEqual([]);
  expect((await reservasDoAluno(db, s.a.slug, "lixo"))!.reservas).toEqual([]);
  expect((await reservasDoAluno(db, s.b.slug, s.ana.id))!.reservas).toEqual([]);
  // a reserva da outra arena é do aluno de lá, não vaza para esta
  expect((await reservasDoAluno(db, s.b.slug, s.anaB.id))!.reservas.map((x) => x.id)).toEqual([deOutraArena.id]);
});

test("reservasDoAluno: mais nova primeiro, janela de retenção da arena e slug inválido/desconhecido", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  const antiga = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(1), fim: h(2), alunoIds: [s.ana.id] }))!;
  const nova = (await criarReserva(db, s.a.id, { quadraId: s.qa.id, inicio: h(3), fim: h(4), alunoIds: [s.ana.id] }))!;
  const clipeAntigo = await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(1, 30));
  await clipeEm(db, s.a.id, s.qa.id, s.ca.id, h(3, 30));
  expect((await reservasDoAluno(db, s.a.slug, s.ana.id))!.reservas.map((x) => x.id)).toEqual([nova.id, antiga.id]);

  // reserva que terminou há mais que dias_retencao (3) não entra
  await db.query("update reservas set inicio = now() - interval '4 days', fim = now() - interval '4 days' + interval '1 hour' where id = $1", [antiga.id]);
  expect((await reservasDoAluno(db, s.a.slug, s.ana.id))!.reservas.map((x) => x.id)).toEqual([nova.id]);
  // dentro dos 3 dias ainda entra (o lance acompanha a reserva)
  await db.query("update clipes set recebido_em = now() - interval '2 days' + interval '30 minutes' where id = $1", [clipeAntigo]);
  await db.query("update reservas set inicio = now() - interval '2 days', fim = now() - interval '2 days' + interval '1 hour' where id = $1", [antiga.id]);
  expect((await reservasDoAluno(db, s.a.slug, s.ana.id))!.reservas.map((x) => x.id)).toEqual([nova.id, antiga.id]);

  expect(await reservasDoAluno(db, "A".repeat(22), s.ana.id)).toBeNull();
  expect(await reservasDoAluno(db, "../x", s.ana.id)).toBeNull();
});

test("arenaDoSlug devolve id e nome; slug malformado não consulta o banco", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  expect(await arenaDoSlug(db, s.a.slug)).toEqual({ arenaId: s.a.id, nome: "Arena A" });
  expect(await arenaDoSlug(db, "A".repeat(22))).toBeNull();
  const espiao = vi.spyOn(db, "query");
  for (const ruim of ["curto", "../x", "", "a b".repeat(10), 42 as unknown as string]) expect(await arenaDoSlug(db, ruim)).toBeNull();
  expect(espiao).not.toHaveBeenCalled();
});

test("slugDaArenaDaQuadra leva o slug da quadra ao da sua arena; desconhecido e malformado dão null", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  expect(await slugDaArenaDaQuadra(db, s.qa.slug)).toBe(s.a.slug);
  expect(await slugDaArenaDaQuadra(db, s.qa2.slug)).toBe(s.a.slug);
  expect(await slugDaArenaDaQuadra(db, s.qb.slug)).toBe(s.b.slug);
  expect(await slugDaArenaDaQuadra(db, "A".repeat(22))).toBeNull();
  expect(await slugDaArenaDaQuadra(db, "../x")).toBeNull();
});

test("slugDaArena devolve o slug da arena do painel; id inválido não consulta o banco", async () => {
  const db = await novoBanco();
  const s = await cenario(db);
  expect(await slugDaArena(db, s.a.id)).toBe(s.a.slug);
  expect(await slugDaArena(db, s.b.id)).toBe(s.b.slug);
  expect(await slugDaArena(db, "0b8f4a52-3c1e-4d7a-9f00-1a2b3c4d5e6f")).toBeNull();
  const espiao = vi.spyOn(db, "query");
  for (const ruim of ["", "x", "1 or 1=1", 42 as unknown as string]) expect(await slugDaArena(db, ruim)).toBeNull();
  expect(espiao).not.toHaveBeenCalled();
});

import { expect, test, vi } from "vitest";
import type { Db } from "../app/lib/db";
import type { MensagemEmail } from "../app/lib/email";
import { avisarCancelamento, criarHandlerLembretes, dadosDoAviso, enviarLembretes, urlDoApp } from "../app/lib/avisos-email";
import { apagarContaJogador, criarContaJogador } from "../app/lib/jogadores";
import { bloquearHorario, cancelarPeloDono, cancelarPeloJogador, criarReserva } from "../app/lib/reservas";
import { novoBanco } from "./db";
import { criarArena, criarHorariosDeHora, criarQuadra } from "./fixtures";

// Segunda, 09/11/2026, 10h em São Paulo. Reservas em 10/11 (terça) = "amanhã".
const AGORA = new Date("2026-11-09T10:00:00-03:00");
const VESPERA_18H = new Date("2026-11-09T18:00:00-03:00");
const DIA = "2026-11-10";
const APP = "https://replay.exemplo";

async function base(db: Db) {
  const arena = await criarArena(db, "Arena Sol");
  await db.query(
    `update arenas set endereco_rua = 'Rua A', endereco_numero = '10', endereco_bairro = 'Centro',
            endereco_cidade = 'Fortaleza', endereco_uf = 'CE', endereco_cep = '60000000' where id = $1`,
    [arena.id],
  );
  const quadra = await criarQuadra(db, arena.id);
  await db.query("update quadras set esporte = 'Padel' where id = $1", [quadra.id]);
  await criarHorariosDeHora(db, arena.id, quadra.id, [0, 1, 2, 3, 4, 5, 6], 7, 23, 10000);
  await db.query("insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'dono@arena.com', 'x', 'dono')", [arena.id]);
  const c = await criarContaJogador(db, { nome: "Ana", email: "ana@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!c.ok) throw new Error("conta");
  const r = await criarReserva(db, c.jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 18 * 60, qtd: 2 }, AGORA);
  if (!r.ok) throw new Error(r.erro);
  return { arena, quadra, jogadorId: c.jogadorId, reservaId: r.reservaId };
}

const coletor = () => {
  const enviados: MensagemEmail[] = [];
  return { enviados, enviar: async (m: MensagemEmail) => void enviados.push(m) };
};

test("dadosDoAviso: arena, endereço, quadra, horário, jogador e e-mails do dono; bloqueio é null", async () => {
  const db = await novoBanco();
  const { arena, quadra, reservaId } = await base(db);
  const d = await dadosDoAviso(db, reservaId);
  expect(d).toMatchObject({
    arena: "Arena Sol", endereco: "Rua A, 10 · Centro · Fortaleza/CE", quadra: "Quadra 1", esporte: "Padel",
    jogador: "Ana", jogadorEmail: "ana@x.com", donos: ["dono@arena.com"], totalCentavos: 20000, motivo: null,
  });
  await bloquearHorario(db, arena.id, { quadraId: quadra.id, dia: DIA, inicio: 8, fim: 9, motivo: "Aula" }, AGORA);
  const b = await db.query<{ id: string }>("select id from reservas where tipo = 'bloqueio'");
  expect(await dadosDoAviso(db, b.rows[0].id)).toBeNull();
  expect(await dadosDoAviso(db, "lixo")).toBeNull();
});

test("jogador cancela: dono recebe o aviso e o jogador a confirmação", async () => {
  const db = await novoBanco();
  const { jogadorId, reservaId } = await base(db);
  const c = coletor();
  expect(await avisarCancelamento(db, reservaId, "jogador", c.enviar, APP)).toBe(0); // ainda confirmada
  expect(await cancelarPeloJogador(db, jogadorId, reservaId, AGORA)).toBe(true); // 32 h antes
  expect(await avisarCancelamento(db, reservaId, "dono", c.enviar, APP)).toBe(0); // não foi o dono
  expect(await avisarCancelamento(db, reservaId, "jogador", c.enviar, APP)).toBe(2);
  const dono = c.enviados.find((m) => m.para === "dono@arena.com")!;
  expect(dono.assunto).toBe("Reserva cancelada pelo jogador · Quadra 1");
  expect(dono.texto).toContain("Ana cancelou a reserva");
  expect(dono.texto).toContain("Terça-feira, 10 de novembro · 18h às 20h");
  expect(dono.texto).toContain(`${APP}/painel/reservas?dia=2026-11-10`);
  const jog = c.enviados.find((m) => m.para === "ana@x.com")!;
  expect(jog.assunto).toBe("Reserva cancelada · Arena Sol");
  expect(jog.texto).toContain("Sua reserva na Arena Sol foi cancelada");
  expect(dono.texto).not.toContain("ana@x.com"); // o dono vê o nome, nunca o e-mail
});

test("dono de outra arena não recebe o aviso", async () => {
  const db = await novoBanco();
  const { jogadorId, reservaId } = await base(db);
  const outra = await criarArena(db, "Outra");
  await db.query("insert into usuarios (arena_id, email, senha_hash, papel) values ($1, 'outro@arena.com', 'x', 'dono')", [outra.id]);
  await cancelarPeloJogador(db, jogadorId, reservaId, AGORA);
  const c = coletor();
  await avisarCancelamento(db, reservaId, "jogador", c.enviar, APP);
  expect(c.enviados.map((m) => m.para).sort()).toEqual(["ana@x.com", "dono@arena.com"]);
});

test("dono cancela: só o jogador recebe, com o motivo", async () => {
  const db = await novoBanco();
  const { arena, reservaId } = await base(db);
  expect(await cancelarPeloDono(db, arena.id, reservaId, "Chuva forte", AGORA)).toBe(true);
  const c = coletor();
  expect(await avisarCancelamento(db, reservaId, "dono", c.enviar, APP)).toBe(1);
  expect(c.enviados[0]).toMatchObject({ para: "ana@x.com", assunto: "Sua reserva foi cancelada pela arena · Arena Sol" });
  expect(c.enviados[0].texto).toContain("Motivo: Chuva forte");
  expect(c.enviados[0].texto).toContain(`${APP}/minhas-reservas`);
});

test("avisarCancelamento: reserva ainda confirmada não manda nada; falha de envio não lança", async () => {
  const db = await novoBanco();
  const { arena, reservaId } = await base(db);
  const c = coletor();
  expect(await avisarCancelamento(db, reservaId, "dono", c.enviar, APP)).toBe(0); // não foi cancelada
  await cancelarPeloDono(db, arena.id, reservaId, "", AGORA);
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  const falha = async () => { throw new Error("smtp caiu"); };
  expect(await avisarCancelamento(db, reservaId, "dono", falha, APP)).toBe(0);
  expect(erro).toHaveBeenCalled();
  expect(erro.mock.calls.flat().join(" ")).not.toContain("ana@x.com");
  erro.mockRestore();
});

test("conta do jogador apagada: o dono ainda é avisado, o jogador não", async () => {
  const db = await novoBanco();
  const { jogadorId, reservaId } = await base(db);
  const cedo = new Date("2026-11-08T10:00:00-03:00");
  await cancelarPeloJogador(db, jogadorId, reservaId, cedo);
  await db.query("update reservas set jogador_id = null where id = $1", [reservaId]);
  const c = coletor();
  expect(await avisarCancelamento(db, reservaId, "jogador", c.enviar, APP)).toBe(1);
  expect(c.enviados[0].para).toBe("dono@arena.com");
  expect(c.enviados[0].texto).toContain("Conta apagada cancelou a reserva");
});

test("lembrete: na véspera, uma vez por reserva, só confirmada de arena ativa", async () => {
  const db = await novoBanco();
  const { arena, quadra, reservaId } = await base(db);
  // Outra reserva confirmada para depois de amanhã: não entra.
  const c2 = await criarContaJogador(db, { nome: "Bia", email: "bia@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!c2.ok) throw new Error("conta");
  const longe = await criarReserva(db, c2.jogadorId, { quadraId: quadra.id, dia: "2026-11-11", inicio: 8 * 60, qtd: 1 }, AGORA);
  expect(longe.ok).toBe(true);

  const c = coletor();
  expect(await enviarLembretes(db, VESPERA_18H, c.enviar, APP)).toEqual({ enviados: 1, falhas: 0 });
  expect(c.enviados[0]).toMatchObject({ para: "ana@x.com", assunto: "Lembrete: amanhã às 18h · Arena Sol" });
  expect(c.enviados[0].texto).toContain("Rua A, 10 · Centro · Fortaleza/CE");
  expect(c.enviados[0].texto).toContain("Pagamento: R$ 200,00, na arena.");
  // Às 18h da véspera, uma reserva das 18h de amanhã já está a menos de 24 h... exatamente 24 h: ainda pode.
  expect(c.enviados[0].texto).toContain("Até 24 h antes é grátis");
  // De novo no mesmo dia: nada (já foi).
  expect(await enviarLembretes(db, VESPERA_18H, c.enviar, APP)).toEqual({ enviados: 0, falhas: 0 });
  expect(c.enviados).toHaveLength(1);
  const marcada = await db.query("select lembrete_enviado_em from reservas where id = $1", [reservaId]);
  expect(marcada.rows[0].lembrete_enviado_em).not.toBeNull();
  // Arena suspensa não recebe.
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [arena.id]);
  const noDiaSeguinte = new Date("2026-11-10T18:00:00-03:00");
  expect(await enviarLembretes(db, noDiaSeguinte, c.enviar, APP)).toEqual({ enviados: 0, falhas: 0 });
});

test("lembrete: falha no envio desmarca para tentar no próximo cron; cancelada e sem conta não recebem", async () => {
  const db = await novoBanco();
  const { reservaId } = await base(db);
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  const falha = async () => { throw new Error("smtp caiu"); };
  expect(await enviarLembretes(db, VESPERA_18H, falha, APP)).toEqual({ enviados: 0, falhas: 1 });
  const r = await db.query("select lembrete_enviado_em from reservas where id = $1", [reservaId]);
  expect(r.rows[0].lembrete_enviado_em).toBeNull();
  erro.mockRestore();

  await db.query("update reservas set jogador_id = null where id = $1", [reservaId]);
  const c = coletor();
  expect(await enviarLembretes(db, VESPERA_18H, c.enviar, APP)).toEqual({ enviados: 0, falhas: 0 });
});

test("lembrete: fora do prazo de cancelar, o texto manda falar com a arena", async () => {
  const db = await novoBanco();
  const { quadra } = await base(db);
  await db.query("delete from reservas");
  const c2 = await criarContaJogador(db, { nome: "Bia", email: "bia@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!c2.ok) throw new Error("conta");
  expect((await criarReserva(db, c2.jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 8 * 60, qtd: 1 }, AGORA)).ok).toBe(true);
  const c = coletor();
  await enviarLembretes(db, VESPERA_18H, c.enviar, APP);
  expect(c.enviados[0].texto).toContain("O prazo para cancelar pelo site já passou; se precisar, fale com a arena.");
  expect(c.enviados[0].texto).not.toContain("grátis");
});

test("lembrete: bordas da janela de amanhã e reserva segurada", async () => {
  const db = await novoBanco();
  const { quadra } = await base(db);
  await db.query("delete from reservas");
  const j = await criarContaJogador(db, { nome: "Bia", email: "bia@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!j.ok) throw new Error("conta");
  const r1 = await criarReserva(db, j.jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 7 * 60, qtd: 1 }, AGORA);
  const r2 = await criarReserva(db, j.jogadorId, { quadraId: quadra.id, dia: "2026-11-11", inicio: 7 * 60, qtd: 1 }, AGORA);
  // Limite de 2 por jogador na arena: a terceira é de outra conta.
  const k = await criarContaJogador(db, { nome: "Caio", email: "caio@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!k.ok) throw new Error("conta");
  const r3 = await criarReserva(db, k.jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 9 * 60, qtd: 1 }, AGORA);
  if (!r1.ok || !r2.ok || !r3.ok) throw new Error("reserva");
  // Bordas exatas: meia-noite de amanhã entra, meia-noite de depois de amanhã não.
  await db.query("update reservas set inicio = $2, fim = $3 where id = $1",
    [r1.reservaId, new Date("2026-11-10T00:00:00-03:00"), new Date("2026-11-10T01:00:00-03:00")]);
  await db.query("update reservas set inicio = $2, fim = $3 where id = $1",
    [r2.reservaId, new Date("2026-11-11T00:00:00-03:00"), new Date("2026-11-11T01:00:00-03:00")]);
  await db.query("update reservas set situacao = 'segurada', segura_ate = now() + interval '1 hour' where id = $1", [r3.reservaId]);
  const c = coletor();
  expect(await enviarLembretes(db, VESPERA_18H, c.enviar, APP)).toEqual({ enviados: 1, falhas: 0 });
  const marcadas = await db.query<{ id: string }>("select id from reservas where lembrete_enviado_em is not null");
  expect(marcadas.rows.map((r) => r.id)).toEqual([r1.reservaId]);
});

test("lembrete: falha no meio do lote só desmarca a que falhou; prazo esgotado deixa o resto desmarcado", async () => {
  const db = await novoBanco();
  const { quadra } = await base(db);
  const j = await criarContaJogador(db, { nome: "Bia", email: "bia@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!j.ok) throw new Error("conta");
  expect((await criarReserva(db, j.jogadorId, { quadraId: quadra.id, dia: DIA, inicio: 8 * 60, qtd: 1 }, AGORA)).ok).toBe(true);
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  let n = 0;
  const umaFalha = async (m: MensagemEmail) => { if (n++ === 0) throw new Error("smtp caiu"); void m; };
  expect(await enviarLembretes(db, VESPERA_18H, umaFalha, APP)).toEqual({ enviados: 1, falhas: 1 });
  const r = await db.query<{ n: number }>("select count(*)::int as n from reservas where lembrete_enviado_em is not null");
  expect(r.rows[0].n).toBe(1);
  erro.mockRestore();

  // Prazo já esgotado antes do primeiro: nada é marcado.
  await db.query("update reservas set lembrete_enviado_em = null");
  const c = coletor();
  expect(await enviarLembretes(db, VESPERA_18H, c.enviar, APP, () => true)).toEqual({ enviados: 0, falhas: 0 });
  const r2 = await db.query<{ n: number }>("select count(*)::int as n from reservas where lembrete_enviado_em is not null");
  expect(r2.rows[0].n).toBe(0);
});

test("urlDoApp: tira espaços e a barra do fim", () => {
  expect(urlDoApp({ APP_URL: " https://x.com/ " })).toBe("https://x.com");
  expect(urlDoApp({ APP_URL: "https://x.com" })).toBe("https://x.com");
  expect(urlDoApp({})).toBe("");
});

test("lembrete: reserva cancelada não recebe, mesmo com a conta apagada depois", async () => {
  const db = await novoBanco();
  const { jogadorId, arena, reservaId } = await base(db);
  await cancelarPeloDono(db, arena.id, reservaId, "", AGORA);
  expect(await apagarContaJogador(db, jogadorId, "senha-boa-1")).toEqual({ ok: true });
  const c = coletor();
  expect(await enviarLembretes(db, VESPERA_18H, c.enviar, APP)).toEqual({ enviados: 0, falhas: 0 });
});

test("handler do cron de lembretes: 503 sem segredo, 401 com segredo errado, 200 com a contagem", async () => {
  const db = await novoBanco();
  await base(db);
  const c = coletor();
  const get = (auth?: string) => new Request("http://x/api/cron/lembretes", { headers: auth ? { authorization: auth } : {} });
  expect((await criarHandlerLembretes(db, c.enviar, APP, undefined, () => VESPERA_18H)(get("Bearer s"))).status).toBe(503);
  expect((await criarHandlerLembretes(db, c.enviar, APP, "segredo-certo", () => VESPERA_18H)(get("Bearer errado"))).status).toBe(401);
  expect(c.enviados).toHaveLength(0);
  const ok = await criarHandlerLembretes(db, c.enviar, APP, "segredo-certo", () => VESPERA_18H)(get("Bearer segredo-certo"));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ enviados: 1, falhas: 0 });
});

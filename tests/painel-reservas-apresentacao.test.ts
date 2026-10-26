import { expect, test } from "vitest";
import type { ItemAgenda } from "../app/lib/reservas";
import {
  MSG_DONO_NAO_CANCELOU,
  perguntaCancelarDono,
  textoPagamentoDono,
  MSG_MOTIVO_LONGO,
  dividirAgenda,
  intervaloAgenda,
  linhaItem,
  mensagemOkAgenda,
  podeAgir,
  porDia,
  quadraDoFiltro,
  calendarioDoDono,
  caixinhasDoDia,
  hrefAgenda,
  lerDiaDono,
  lerMesDono,
  lerPagina,
  mensagemDoBloqueio,
  mesesDoDono,
  paginarCaixinhas,
  semanaDoDia,
  comAviso,
  voltaSegura,
} from "../app/painel/reservas/apresentacao";

const AGORA = new Date("2026-10-24T15:00:00Z"); // 12h em São Paulo

function item(p: Partial<ItemAgenda>): ItemAgenda {
  return {
    id: "1", tipo: "reserva", quadraId: "q1", quadra: "Quadra 1", esporte: "Padel",
    inicio: new Date("2026-10-26T19:00:00Z"), fim: new Date("2026-10-26T21:00:00Z"),
    situacao: "confirmada", jogador: "Ana", totalCentavos: 20000, motivo: null, canceladaPor: null, motivoCancelamento: null, futura: true,
    pagamento: "arena",
    ...p,
  };
}

test("mensagemOkAgenda só aceita os valores fixos", () => {
  expect(mensagemOkAgenda("cancelada")).toBe("Reserva cancelada.");
  expect(mensagemOkAgenda("bloqueado")).toBe("Horário bloqueado.");
  expect(mensagemOkAgenda("removido")).toBe("Bloqueio removido.");
  expect(mensagemOkAgenda(["removido", "x"])).toBe("Bloqueio removido.");
  expect(mensagemOkAgenda("<script>")).toBeNull();
  expect(mensagemOkAgenda(undefined)).toBeNull();
});

test("mensagens fixas do cancelamento pelo dono", () => {
  expect(MSG_MOTIVO_LONGO).toBe("O motivo pode ter até 120 caracteres.");
  expect(MSG_DONO_NAO_CANCELOU).toBe("Não foi possível cancelar. A reserva já começou ou não existe mais.");
});

test("linhaItem: reserva, conta apagada, quadra sem esporte, bloqueio e canceladas", () => {
  expect(linhaItem(item({}))).toBe("16h–18h · Quadra 1 — Padel · Ana · R$ 200,00 · Confirmada");
  expect(linhaItem(item({ jogador: "Conta apagada", esporte: "" }))).toBe(
    "16h–18h · Quadra 1 · Conta apagada · R$ 200,00 · Confirmada",
  );
  // atravessa a meia-noite: 22h–1h; terminar à meia-noite é 24h
  expect(linhaItem(item({ inicio: new Date("2026-10-27T01:00:00Z"), fim: new Date("2026-10-27T04:00:00Z") }))).toMatch(/^22h–1h /);
  expect(linhaItem(item({ inicio: new Date("2026-10-27T01:00:00Z"), fim: new Date("2026-10-27T03:00:00Z") }))).toMatch(/^22h–24h /);
  expect(linhaItem(item({ situacao: "cancelada", canceladaPor: "jogador" }))).toMatch(/ · Cancelada pelo jogador$/);
  expect(linhaItem(item({ situacao: "cancelada", canceladaPor: "dono", motivo: null }))).toMatch(/ · Cancelada pela arena$/);
  expect(linhaItem(item({ situacao: "cancelada", canceladaPor: "dono", motivoCancelamento: "Chuva forte" }))).toBe(
    "16h–18h · Quadra 1 — Padel · Ana · R$ 200,00 · Cancelada pela arena · Chuva forte",
  );
  expect(linhaItem(item({ tipo: "bloqueio", jogador: null, totalCentavos: null, motivo: "Aula" }))).toBe(
    "16h–18h · Quadra 1 — Padel · Bloqueado · Aula",
  );
  expect(linhaItem(item({ tipo: "bloqueio", jogador: null, totalCentavos: null, motivo: "Aula", situacao: "cancelada" }))).toBe(
    "16h–18h · Quadra 1 — Padel · Bloqueado · Aula · Removido",
  );
});

test("intervaloAgenda: 30 dias para trás até 13 dias à frente; agenda tem 14 dias", () => {
  expect(intervaloAgenda(AGORA)).toEqual({ de: "2026-09-24", ate: "2026-11-06", dias: expect.any(Array) });
  const { dias } = intervaloAgenda(AGORA);
  expect(dias).toHaveLength(14);
  expect(dias[0]).toBe("2026-10-24");
  expect(dias[13]).toBe("2026-11-06");
});

test("dividirAgenda: agenda com tudo que não terminou (inclusive canceladas futuras); histórico só passadas, mais recentes primeiro", () => {
  const jogo = item({ id: "jogo" });
  const agoraJogando = item({ id: "agora", inicio: new Date("2026-10-24T14:00:00Z"), fim: new Date("2026-10-24T16:00:00Z"), futura: false });
  const passada = item({ id: "passada", inicio: new Date("2026-10-01T19:00:00Z"), fim: new Date("2026-10-01T20:00:00Z"), futura: false });
  const antiga = item({ id: "antiga", inicio: new Date("2026-09-25T19:00:00Z"), fim: new Date("2026-09-25T20:00:00Z"), futura: false });
  const passadaCancelada = item({ id: "passada-cancelada", situacao: "cancelada", canceladaPor: "dono", inicio: new Date("2026-10-10T19:00:00Z"), fim: new Date("2026-10-10T20:00:00Z"), futura: false });
  const cancelada = item({ id: "cancelada", situacao: "cancelada", canceladaPor: "jogador" });
  const { proximas, historico } = dividirAgenda([antiga, passada, passadaCancelada, agoraJogando, jogo, cancelada], AGORA);
  expect(proximas.map((i) => i.id)).toEqual(["agora", "jogo", "cancelada"]);
  expect(historico.map((i) => i.id)).toEqual(["passada-cancelada", "passada", "antiga"]);
});

test("podeAgir: botão só em item futuro e confirmado", () => {
  expect(podeAgir(item({}))).toBe(true);
  expect(podeAgir(item({ situacao: "cancelada", canceladaPor: "jogador" }))).toBe(false);
  expect(podeAgir(item({ futura: false }))).toBe(false);
});

test("porDia agrupa pelo dia local do início, mantendo os dias vazios", () => {
  const a = item({ id: "a" });
  const b = item({ id: "b", inicio: new Date("2026-10-27T01:00:00Z"), fim: new Date("2026-10-27T03:00:00Z") }); // 26/10 22h
  const c = item({ id: "c", inicio: new Date("2026-10-27T12:00:00Z"), fim: new Date("2026-10-27T13:00:00Z") });
  const g = porDia(["2026-10-26", "2026-10-27", "2026-10-28"], [a, b, c]);
  expect(g.map((x) => [x.dia, x.itens.map((i) => i.id)])).toEqual([
    ["2026-10-26", ["a", "b"]], ["2026-10-27", ["c"]], ["2026-10-28", []],
  ]);
});

test("porDia: jogo em andamento que começou antes do primeiro dia fica no primeiro dia", () => {
  const ontem = item({ id: "ontem", inicio: new Date("2026-10-24T02:00:00Z"), fim: new Date("2026-10-24T04:00:00Z") }); // 23/10 23h–1h
  const g = porDia(["2026-10-24", "2026-10-25"], [ontem, item({ id: "hoje", inicio: new Date("2026-10-24T19:00:00Z") })]);
  expect(g.map((x) => [x.dia, x.itens.map((i) => i.id)])).toEqual([["2026-10-24", ["ontem", "hoje"]], ["2026-10-25", []]]);
});

test("quadraDoFiltro só aceita quadra da arena", () => {
  const quadras = [{ id: "q1" }, { id: "q2" }];
  expect(quadraDoFiltro("q2", quadras)).toBe("q2");
  expect(quadraDoFiltro(["q1"], quadras)).toBe("q1");
  expect(quadraDoFiltro("outra", quadras)).toBeNull();
  expect(quadraDoFiltro("", quadras)).toBeNull();
  expect(quadraDoFiltro(undefined, quadras)).toBeNull();
});

test("linhaItem: horário com minutos aparece como 15h30–17h15", () => {
  const i = item({ inicio: new Date("2026-10-26T18:30:00Z"), fim: new Date("2026-10-26T20:15:00Z") });
  expect(linhaItem(i)).toBe("15h30–17h15 · Quadra 1 — Padel · Ana · R$ 200,00 · Confirmada");
});

// ---------- Fase 6: calendário e caixinhas ----------
// AGORA = sábado, 24/10/2026, 12h em São Paulo; a janela vai até 23/11.

test("lerDiaDono e mesesDoDono: de 3 meses para trás até o fim da janela", () => {
  expect(mesesDoDono(AGORA)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  expect(lerDiaDono(undefined, AGORA)).toBe("2026-10-24");
  expect(lerDiaDono("2026-07-01", AGORA)).toBe("2026-07-01");
  expect(lerDiaDono("2026-06-30", AGORA)).toBe("2026-10-24");
  expect(lerDiaDono("2026-11-23", AGORA)).toBe("2026-11-23");
  expect(lerDiaDono("2026-11-24", AGORA)).toBe("2026-10-24");
  expect(lerDiaDono(["2026-10-30", "x"], AGORA)).toBe("2026-10-30");
  expect(lerDiaDono("2026-02-31", AGORA)).toBe("2026-10-24");
  expect(lerDiaDono("lixo", AGORA)).toBe("2026-10-24");
});

test("lerMesDono e lerPagina", () => {
  expect(lerMesDono(undefined, "2026-11-03", AGORA)).toBe("2026-11");
  expect(lerMesDono("2026-08", "2026-11-03", AGORA)).toBe("2026-08");
  expect(lerMesDono("2026-12", "2026-11-03", AGORA)).toBe("2026-11");
  expect(lerMesDono("lixo", "2026-10-24", AGORA)).toBe("2026-10");
  expect(lerPagina(undefined)).toBe(1);
  expect(lerPagina("3")).toBe(3);
  expect(lerPagina(["2", "9"])).toBe(2);
  expect(lerPagina("0")).toBe(1);
  expect(lerPagina("1.5")).toBe(1);
  expect(lerPagina("99999")).toBe(1);
});

test("semanaDoDia: domingo a sábado, inclusive na virada de mês", () => {
  expect(semanaDoDia("2026-10-28")).toEqual([
    "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31",
  ]);
  expect(semanaDoDia("2026-11-01")[0]).toBe("2026-11-01"); // domingo abre a própria semana
  expect(semanaDoDia("2026-11-03")).toContain("2026-11-07");
  expect(semanaDoDia("2026-10-31")[6]).toBe("2026-10-31");
});

test("calendarioDoDono: contagem, escolhido, hoje e dias fora da faixa", () => {
  const porDia = new Map([["2026-10-26", 4], ["2026-10-24", 2]]);
  const sem = calendarioDoDono("2026-10", porDia, "2026-10-26", AGORA);
  expect(sem[0].map((d) => d.dia)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  const achar = (dia: string) => sem.flat().find((d) => d.dia === dia)!;
  expect(achar("2026-10-26")).toMatchObject({ numero: 26, doMes: true, n: 4, escolhido: true, hoje: false, naFaixa: true });
  expect(achar("2026-10-24")).toMatchObject({ n: 2, hoje: true, escolhido: false });
  expect(achar("2026-09-30")).toMatchObject({ doMes: false });
  const nov = calendarioDoDono("2026-11", new Map(), "2026-10-24", AGORA).flat();
  expect(nov.find((d) => d.dia === "2026-11-23")!.naFaixa).toBe(true);
  expect(nov.find((d) => d.dia === "2026-11-24")!.naFaixa).toBe(false);
});

const hq = (id: string, diaSemana: number, inicio: number, fim: number, precoCentavos = 8000) => ({ id, diaSemana, inicio, fim, precoCentavos });
// Segunda, 26/10: horários de 7h a 12h na q1; um só na q2.
const QUADRAS = [
  { id: "q1", nome: "Quadra 1", esporte: "Padel", horarios: [hq("a", 1, 420, 480), hq("b", 1, 480, 540), hq("c", 1, 540, 600), hq("d", 1, 600, 660), hq("e", 1, 660, 720), hq("x", 2, 420, 480)] },
  { id: "q2", nome: "Quadra 2", esporte: "", horarios: [hq("f", 1, 1080, 1140, 12000)] },
];
const em = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 26, h + 3, m)); // 26/10 em São Paulo

test("caixinhasDoDia: reserva e bloqueio no lugar dos livres, por quadra e em ordem", () => {
  const itens = [
    item({ id: "r1", quadraId: "q1", inicio: em(7), fim: em(9) }),
    item({ id: "b1", quadraId: "q1", tipo: "bloqueio", jogador: null, motivo: "Aula", inicio: em(10), fim: em(11) }),
    item({ id: "c1", quadraId: "q1", situacao: "cancelada", canceladaPor: "jogador", inicio: em(9), fim: em(10) }),
    item({ id: "outro-dia", quadraId: "q1", inicio: new Date("2026-10-27T10:00:00Z"), fim: new Date("2026-10-27T11:00:00Z") }),
  ];
  const g = caixinhasDoDia(itens, QUADRAS, "2026-10-26", AGORA);
  expect(g.map((x) => x.quadraId)).toEqual(["q1", "q2"]);
  expect(g[0].caixinhas.map((c) => [c.tipo, c.inicio, c.fim, c.tipo === "livre" ? null : c.item.id])).toEqual([
    ["reserva", 420, 540, "r1"],
    ["reserva", 540, 600, "c1"], // cancelada fica, apagada
    ["livre", 540, 600, null], // e o horário volta a ficar livre
    ["bloqueio", 600, 660, "b1"],
    ["livre", 660, 720, null],
  ]);
  expect(g[0].livres).toEqual([{ inicio: 540, fim: 600 }, { inicio: 660, fim: 720 }]);
  expect(g[1].caixinhas).toEqual([{ tipo: "livre", inicio: 1080, fim: 1140, precoCentavos: 12000 }]);
});

test("caixinhasDoDia: hoje, só os livres que ainda não começaram", () => {
  const sabado = [{ id: "q1", nome: "Q", esporte: "", horarios: [hq("a", 6, 600, 660), hq("b", 6, 780, 840)] }];
  const g = caixinhasDoDia([], sabado, "2026-10-24", AGORA); // agora = 12h
  expect(g[0].caixinhas.map((c) => c.inicio)).toEqual([780]);
});

test("paginarCaixinhas: 12 por página atravessando as quadras", () => {
  const livres = (q: string, n: number) => ({
    quadraId: q, quadra: q, esporte: "", livres: [],
    caixinhas: Array.from({ length: n }, (_, i) => ({ tipo: "livre" as const, inicio: i * 60, fim: i * 60 + 60, precoCentavos: 1 })),
  });
  const grupos = [livres("q1", 10), livres("q2", 5)];
  const p1 = paginarCaixinhas(grupos, 1, 12);
  expect(p1.paginas).toBe(2);
  expect(p1.grupos.map((g) => [g.quadraId, g.caixinhas.length])).toEqual([["q1", 10], ["q2", 2]]);
  const p2 = paginarCaixinhas(grupos, 2, 12);
  expect(p2.grupos.map((g) => [g.quadraId, g.caixinhas.length])).toEqual([["q2", 3]]);
  expect(paginarCaixinhas(grupos, 9, 12).pagina).toBe(2);
  const vazio = paginarCaixinhas([livres("q1", 0)], 1, 12);
  expect(vazio).toMatchObject({ pagina: 1, paginas: 1 });
  expect(vazio.grupos.map((g) => g.quadraId)).toEqual(["q1"]);
});

test("hrefAgenda omite o vazio e a página 1", () => {
  expect(hrefAgenda({})).toBe("/painel/reservas");
  expect(hrefAgenda({ quadra: "q1", dia: "2026-10-26", mes: "2026-10", pagina: 1 })).toBe("/painel/reservas?quadra=q1&dia=2026-10-26&mes=2026-10");
  expect(hrefAgenda({ busca: "a&b", pagina: 2 })).toBe("/painel/reservas?busca=a%26b&pagina=2");
  expect(hrefAgenda({ dia: "2026-10-26", ver: "mes" })).toBe("/painel/reservas?dia=2026-10-26&ver=mes");
});

test("mensagemDoBloqueio: só números, no singular e no plural", () => {
  expect(mensagemDoBloqueio("1", "0")).toBe("1 horário bloqueado.");
  expect(mensagemDoBloqueio("3", "2")).toBe("3 horários bloqueados. 2 pulados (já ocupados ou começados).");
  expect(mensagemDoBloqueio("0", "1")).toBe("Nenhum horário bloqueado. 1 pulado (já ocupado ou começado).");
  expect(mensagemDoBloqueio("<b>", "1")).toBeNull();
  expect(mensagemDoBloqueio(undefined, undefined)).toBeNull();
  expect(mensagemDoBloqueio("999", "0")).toBeNull();
  expect(mensagemOkAgenda("desbloqueado")).toBe("Bloqueio removido.");
});

test("voltaSegura: só caminhos da agenda; comAviso soma o aviso", () => {
  expect(voltaSegura("/painel/reservas?quadra=q1&dia=2026-10-26&pagina=2")).toBe("/painel/reservas?quadra=q1&dia=2026-10-26&pagina=2");
  expect(voltaSegura("/painel/reservas")).toBe("/painel/reservas");
  expect(voltaSegura("https://mal.com/painel/reservas")).toBe("/painel/reservas");
  expect(voltaSegura("//mal.com")).toBe("/painel/reservas");
  expect(voltaSegura("/painel/reservas/../../x")).toBe("/painel/reservas");
  expect(voltaSegura("/painel/reservas?x=<script>")).toBe("/painel/reservas");
  expect(voltaSegura(null)).toBe("/painel/reservas");
  expect(comAviso("/painel/reservas", { ok: "cancelada" })).toBe("/painel/reservas?ok=cancelada");
  expect(comAviso("/painel/reservas?dia=2026-10-26&ok=velho", { bloqueados: "2", pulados: "0" }))
    .toBe("/painel/reservas?dia=2026-10-26&bloqueados=2&pulados=0");
});

test("voltaSegura: busca com espaço (+) e asterisco volta inteira", () => {
  const volta = hrefAgenda({ dia: "2026-10-26", busca: "Ana Maria*", pagina: 2 });
  expect(volta).toBe("/painel/reservas?dia=2026-10-26&busca=Ana+Maria*&pagina=2");
  expect(voltaSegura(volta)).toBe(volta);
  expect(voltaSegura("/painel/reservas?busca=a+b&x=//mal.com")).toBe("/painel/reservas");
});

test("pagamento na agenda do dono e pergunta do cancelamento de reserva paga online", () => {
  expect(textoPagamentoDono("online")).toBe("pago online");
  expect(textoPagamentoDono("arena")).toBe("pagar na arena");
  expect(perguntaCancelarDono("18h · Ana", "arena")).toBe("Cancelar a reserva 18h · Ana? O horário volta a ficar livre.");
  expect(perguntaCancelarDono("18h · Ana", "online")).toBe(
    "Cancelar a reserva 18h · Ana? O horário volta a ficar livre. O jogador recebe o valor inteiro de volta; a tarifa do Asaas sai da parte da arena.");
});

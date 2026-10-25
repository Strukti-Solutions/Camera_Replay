import { expect, test } from "vitest";
import type { HorarioDoDia } from "../app/lib/disponibilidade";
import {
  calendarioDoMes, diaPorExtenso, estadoDoDia, hrefDoHorario, hrefPasso1, hrefPasso2, hrefPasso3, hrefReservar, lerEscolha,
  lerMes, lerReserva, linkComoChegar, livresPorDia, mesesDaJanela, nomeDoMes, passoDaEscolha, passoDaUrl, textoDia, textoLances,
} from "../app/a/[slug]/apresentacao";
import type { HorarioComId } from "../app/lib/horarios";

// 17/10/2026, 17:00 em São Paulo.
const agora = new Date("2026-10-17T20:00:00Z");

test("dia do lance: hoje, ontem ou dd/mm, no dia civil de São Paulo", () => {
  expect(textoDia(new Date("2026-10-17T11:00:00Z"), agora)).toBe("hoje");
  // 23:30 de 16/10 em São Paulo já é 17/10 em UTC: continua "ontem".
  expect(textoDia(new Date("2026-10-17T02:30:00Z"), agora)).toBe("ontem");
  expect(textoDia(new Date("2026-10-15T12:00:00Z"), agora)).toBe("15/10");
});

test("quantidade de lances no singular e no plural", () => {
  expect(textoLances(1)).toBe("1 lance");
  expect(textoLances(4)).toBe("4 lances");
});

test("lerEscolha ignora o que não presta", () => {
  const ids = ["q1", "q2"];
  // 17/10/2026 em São Paulo.
  expect(lerEscolha({}, ids, agora)).toEqual({ quadra: null, dia: "2026-10-17", inicio: null, qtd: 1 });
  expect(
    lerEscolha({ quadra: "q9", dia: "<script>", inicio: "abc", qtd: "9" }, ids, agora),
  ).toEqual({ quadra: null, dia: "2026-10-17", inicio: null, qtd: 1 });
  expect(lerEscolha({ quadra: "q2", dia: "2026-10-20", inicio: "930", qtd: "2" }, ids, agora)).toEqual({
    quadra: "q2",
    dia: "2026-10-20",
    inicio: 930,
    qtd: 2,
  });
  expect(lerEscolha({ inicio: "1440", qtd: "0" }, ids, agora)).toMatchObject({ inicio: null, qtd: 1 });
  expect(lerEscolha({ inicio: "1439", qtd: "5" }, ids, agora)).toMatchObject({ inicio: 1439, qtd: 1 });
  expect(lerEscolha({ inicio: "7.5", qtd: "2.5" }, ids, agora)).toMatchObject({ inicio: null, qtd: 1 });
  expect(lerEscolha({ inicio: "12345", qtd: "1" }, ids, agora)).toMatchObject({ inicio: null });
  // zero à esquerda não vale (0930 não é 930)
  expect(lerEscolha({ inicio: "0930", qtd: "01" }, ids, agora)).toMatchObject({ inicio: null, qtd: 1 });
  expect(lerEscolha({ inicio: "0", qtd: "1" }, ids, agora)).toMatchObject({ inicio: 0 });
  expect(lerReserva({ quadra: "q1", dia: "2026-10-20", inicio: "0930", qtd: "2" }, ids, agora)).toBeNull();
  expect(
    lerEscolha({ quadra: ["q1", "q2"], dia: ["2026-10-18", "x"], inicio: ["480", "9"], qtd: ["3", "1"] }, ids, agora),
  ).toEqual({ quadra: "q1", dia: "2026-10-18", inicio: 480, qtd: 3 });
});

test("linkComoChegar", () => {
  expect(linkComoChegar({ latitude: -3.72, longitude: -38.48, endereco: null })).toContain("query=-3.72,-38.48");
  const porEndereco = linkComoChegar({
    latitude: null,
    longitude: null,
    endereco: { rua: "Rua A", numero: "10", bairro: "Centro", cidade: "Fortaleza", uf: "CE", cep: null },
  });
  expect(porEndereco).toContain(`query=${encodeURIComponent("Rua A, 10 - Centro, Fortaleza - CE")}`);
  expect(linkComoChegar({ latitude: null, longitude: null, endereco: null })).toBeNull();
});

test("hrefReservar monta a URL do contrato", () => {
  expect(hrefReservar({ quadra: "q1", dia: "2026-10-26", inicio: 930, qtd: 2 })).toBe(
    "/reservar?quadra=q1&dia=2026-10-26&inicio=930&qtd=2",
  );
  // Valor cru da URL é codificado, nunca vira outro parâmetro.
  expect(hrefReservar({ quadra: "a&b=c", dia: "x y", inicio: "1#", qtd: "" })).toBe(
    "/reservar?quadra=a%26b%3Dc&dia=x+y&inicio=1%23&qtd=",
  );
});

test("dia por extenso em pt-BR", () => {
  expect(diaPorExtenso("2026-10-26")).toBe("Segunda-feira, 26 de outubro");
  expect(diaPorExtenso("2026-11-01")).toBe("Domingo, 1 de novembro");
  expect(diaPorExtenso("2026-12-05")).toBe("Sábado, 5 de dezembro");
});

test("lerReserva exige a escolha completa e não troca nada pelo padrão", () => {
  const ids = ["q1", "q2"];
  const ok = { quadra: "q2", dia: "2026-10-20", inicio: "930", qtd: "2" };
  expect(lerReserva(ok, ids, agora)).toEqual({ quadra: "q2", dia: "2026-10-20", inicio: 930, qtd: 2 });
  expect(lerReserva({ ...ok, quadra: "q9" }, ids, agora)).toBeNull();
  expect(lerReserva({ ...ok, dia: "2026-10-16" }, ids, agora)).toBeNull();
  expect(lerReserva({ ...ok, dia: undefined }, ids, agora)).toBeNull();
  expect(lerReserva({ ...ok, inicio: "1440" }, ids, agora)).toBeNull();
  expect(lerReserva({ ...ok, inicio: undefined }, ids, agora)).toBeNull();
  expect(lerReserva({ ...ok, qtd: "9" }, ids, agora)).toBeNull();
  expect(lerReserva({ ...ok, qtd: undefined }, ids, agora)).toBeNull();
});

// Horários do dia: 15h30–17h15, 17h15–18h, 18h–19h, 19h–20h, 20h–21h, 21h–22h (o de 19h está ocupado).
const mk = (inicio: number, fim: number, livre = true): HorarioDoDia => ({
  horario: { id: `h${inicio}`, diaSemana: 1, inicio, fim, precoCentavos: 10000 }, livre,
});
const dia = [mk(930, 1035), mk(1035, 1080), mk(1080, 1140), mk(1140, 1200, false), mk(1200, 1260), mk(1260, 1320)];
const base = { slug: "arena-teste", quadra: "q1", dia: "2026-10-26" };
const alvoHref = (sel: { inicio: number; qtd: number } | null, alvo: number) => hrefDoHorario(base, dia, sel, alvo);
const consulta = (href: string) => Object.fromEntries(new URLSearchParams(href.split("#")[0].split("?")[1]));

test("hrefDoHorario: sem seleção, escolhe só o alvo", () => {
  const h = alvoHref(null, 2);
  expect(h.startsWith("/a/arena-teste?")).toBe(true);
  expect(h.endsWith("#reserva")).toBe(true);
  expect(consulta(h)).toEqual({ quadra: "q1", dia: "2026-10-26", inicio: "1080", qtd: "1" });
});

test("hrefDoHorario: alvo livre colado ao fim da seleção soma um horário (até 4)", () => {
  expect(consulta(alvoHref({ inicio: 930, qtd: 1 }, 1))).toMatchObject({ inicio: "930", qtd: "2" });
  expect(consulta(alvoHref({ inicio: 930, qtd: 2 }, 2))).toMatchObject({ inicio: "930", qtd: "3" });
  // 4 já escolhidos: o alvo colado não entra, recomeça nele
  const seis = [mk(0, 60), mk(60, 120), mk(120, 180), mk(180, 240), mk(240, 300)];
  expect(consulta(hrefDoHorario(base, seis, { inicio: 0, qtd: 4 }, 4))).toMatchObject({ inicio: "240", qtd: "1" });
});

test("hrefDoHorario: passar de 12 h recomeça no alvo", () => {
  const longos = [mk(0, 420), mk(420, 840), mk(840, 1200)];
  expect(consulta(hrefDoHorario(base, longos, { inicio: 0, qtd: 1 }, 1))).toMatchObject({ inicio: "420", qtd: "1" }); // 14 h
  const seis = [mk(0, 360), mk(360, 720)];
  expect(consulta(hrefDoHorario(base, seis, { inicio: 0, qtd: 1 }, 1))).toMatchObject({ inicio: "0", qtd: "2" }); // 12 h
});

test("hrefDoHorario: alvo colado mas ocupado não soma (e nem vira link na tela)", () => {
  expect(consulta(alvoHref({ inicio: 1080, qtd: 1 }, 3))).toMatchObject({ inicio: "1140", qtd: "1" });
});

test("hrefDoHorario: o último da seleção maior sai", () => {
  expect(consulta(alvoHref({ inicio: 930, qtd: 3 }, 2))).toMatchObject({ inicio: "930", qtd: "2" });
});

test("hrefDoHorario: o único selecionado tira a seleção", () => {
  const h = alvoHref({ inicio: 1080, qtd: 1 }, 2);
  expect(consulta(h)).toEqual({ quadra: "q1", dia: "2026-10-26" });
  expect(h.endsWith("#reserva")).toBe(true);
});

test("hrefDoHorario: alvo no meio ou no começo de seleção maior recomeça nele", () => {
  expect(consulta(alvoHref({ inicio: 930, qtd: 3 }, 1))).toMatchObject({ inicio: "1035", qtd: "1" });
  expect(consulta(alvoHref({ inicio: 930, qtd: 3 }, 0))).toMatchObject({ inicio: "930", qtd: "1" });
});

test("hrefDoHorario: alvo solto fora da seleção recomeça nele", () => {
  expect(consulta(alvoHref({ inicio: 930, qtd: 2 }, 5))).toMatchObject({ inicio: "1260", qtd: "1" });
  expect(consulta(alvoHref({ inicio: 1200, qtd: 1 }, 0))).toMatchObject({ inicio: "930", qtd: "1" });
});

// Domingo, 25/10/2026, 10h em São Paulo: a janela vai até 24/11.
const domingo = new Date("2026-10-25T13:00:00Z");

// Horários de 1 h, das 7h às 23h, todos os dias.
const deHora: HorarioComId[] = [0, 1, 2, 3, 4, 5, 6].flatMap((d) =>
  Array.from({ length: 16 }, (_, k) => ({ id: `h${d}-${k}`, diaSemana: d, inicio: (7 + k) * 60, fim: (8 + k) * 60, precoCentavos: 6000 })),
);

test("passo: sem quadra 1, quadra sem dia 2, quadra e dia 3", () => {
  expect(passoDaEscolha({ quadra: null, diaNaUrl: false })).toBe(1);
  expect(passoDaEscolha({ quadra: null, diaNaUrl: true })).toBe(1);
  expect(passoDaEscolha({ quadra: "q1", diaNaUrl: false })).toBe(2);
  expect(passoDaEscolha({ quadra: "q1", diaNaUrl: true })).toBe(3);
});

test("meses da janela e mês da URL: só os que tocam a janela", () => {
  expect(mesesDaJanela(domingo)).toEqual(["2026-10", "2026-11"]);
  expect(mesesDaJanela(new Date("2026-10-01T13:00:00Z"))).toEqual(["2026-10"]);
  expect(lerMes("2026-11", domingo)).toBe("2026-11");
  expect(lerMes(["2026-11"], domingo)).toBe("2026-11");
  for (const v of ["2027-01", "2026-09", "lixo", "2026-1", "2026-13", undefined]) expect(lerMes(v, domingo)).toBe("2026-10");
  expect(nomeDoMes("2026-10")).toBe("Outubro 2026");
  expect(nomeDoMes("2026-03")).toBe("Março 2026");
});

test("estado do dia: 3+ livre, 1–2 poucos, 0 ou fora da janela indisponível", () => {
  expect(estadoDoDia(3, true)).toBe("livre");
  expect(estadoDoDia(2, true)).toBe("poucos");
  expect(estadoDoDia(1, true)).toBe("poucos");
  expect(estadoDoDia(0, true)).toBe("indisponivel");
  expect(estadoDoDia(9, false)).toBe("indisponivel");
});

test("livres por dia: conta só o que começa depois de agora e não toca período ocupado", () => {
  const ocupado = [{ inicio: new Date("2026-10-26T18:00:00-03:00"), fim: new Date("2026-10-26T20:00:00-03:00") }];
  const m = livresPorDia(deHora, domingo, ocupado);
  expect(m.get("2026-10-25")).toBe(12); // 11h a 22h
  expect(m.get("2026-10-26")).toBe(14); // 16 menos 18h e 19h
  expect(m.get("2026-11-24")).toBe(16);
  expect(m.has("2026-11-25")).toBe(false);
  expect(m.size).toBe(31);
  // 23h30: o último horário de hoje (22h) já começou.
  expect(livresPorDia(deHora, new Date("2026-10-26T02:30:00Z"), []).get("2026-10-25")).toBe(0);
});

test("calendário de outubro: semanas de domingo a sábado, passado e fora do mês apagados", () => {
  const cal = calendarioDoMes("2026-10", domingo, livresPorDia(deHora, domingo, []));
  expect(cal).toHaveLength(5);
  expect(cal[0].map((d) => d.numero)).toEqual([27, 28, 29, 30, 1, 2, 3]);
  expect(cal[0][0]).toMatchObject({ dia: "2026-09-27", doMes: false, estado: "indisponivel" });
  const d = (dia: string) => cal.flat().find((x) => x.dia === dia)!;
  expect(d("2026-10-24").estado).toBe("indisponivel");
  expect(d("2026-10-25").estado).toBe("livre");
  expect(cal[4].map((x) => x.numero)).toEqual([25, 26, 27, 28, 29, 30, 31]);
});

test("calendário de novembro: até 24/11 na janela, depois apagado", () => {
  const cal = calendarioDoMes("2026-11", domingo, livresPorDia(deHora, domingo, []));
  const d = (dia: string) => cal.flat().find((x) => x.dia === dia)!;
  expect(cal[0][0].dia).toBe("2026-11-01");
  expect(d("2026-11-24").estado).toBe("livre");
  expect(d("2026-11-25").estado).toBe("indisponivel");
  expect(cal[cal.length - 1].at(-1)).toMatchObject({ dia: "2026-12-05", doMes: false });
});

test("links dos passos: codificados e com a âncora do cartão", () => {
  expect(hrefPasso1("a b")).toBe("/a/a%20b#reserva");
  expect(hrefPasso2("slug", "q&1")).toBe("/a/slug?quadra=q%261#reserva");
  expect(hrefPasso2("slug", "q1", "2026-11")).toBe("/a/slug?quadra=q1&mes=2026-11#reserva");
  expect(hrefPasso3("slug", "q1", "2026-10-26")).toBe("/a/slug?quadra=q1&dia=2026-10-26#reserva");
});

test("passoDaUrl: link velho e dia fora da janela abrem o passo 2", () => {
  const ids = ["q1"];
  // agora = 17/10/2026; a janela vai até 16/11.
  expect(passoDaUrl({}, ids, agora)).toBe(1);
  expect(passoDaUrl({ quadra: "q9", dia: "2026-10-20" }, ids, agora)).toBe(1);
  expect(passoDaUrl({ quadra: "q1" }, ids, agora)).toBe(2);
  expect(passoDaUrl({ quadra: "q1", dia: "2026-12-01" }, ids, agora)).toBe(2);
  expect(passoDaUrl({ quadra: "q1", dia: "lixo" }, ids, agora)).toBe(2);
  expect(passoDaUrl({ quadra: "q1", dia: "2026-10-20" }, ids, agora)).toBe(3);
  expect(passoDaUrl({ quadra: "q1", dia: ["2026-10-20", "x"] }, ids, agora)).toBe(3);
});

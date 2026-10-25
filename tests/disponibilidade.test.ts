import { describe, expect, it, test } from "vitest";
import { diaDaSemana, diaValido, diasDisponiveis, escolhaDeHorarios, hojeLocal, horariosDoDia, instanteDoMinuto, minutoDoFim, partesDoInstante } from "../app/lib/disponibilidade";
import type { HorarioComId } from "../app/lib/horarios";

const AGORA = new Date("2026-10-23T21:30:00Z"); // sexta 18h30 em São Paulo
let seq = 0;
const hor = (diaSemana: number, inicio: number, fim: number, precoCentavos = 12000): HorarioComId => ({
  id: `h${++seq}`, diaSemana, inicio, fim, precoCentavos,
});
const SEG = "2026-10-26"; // segunda
const SEX = "2026-10-30"; // sexta
const sexta: HorarioComId[] = [
  hor(5, 18 * 60, 19 * 60), hor(5, 19 * 60, 20 * 60), hor(5, 20 * 60, 21 * 60), hor(5, 21 * 60, 22 * 60), hor(5, 22 * 60, 23 * 60),
];
const periodo = (de: string, ate: string) => ({ inicio: new Date(de), fim: new Date(ate) });

describe("disponibilidade", () => {
  it("hojeLocal usa o fuso de São Paulo", () => {
    expect(hojeLocal(new Date("2026-10-24T02:30:00Z"))).toBe("2026-10-23");
  });

  it("diaDaSemana não depende do fuso da máquina", () => {
    expect(diaDaSemana("2026-10-23")).toBe(5);
    expect(diaDaSemana("2026-10-25")).toBe(0);
  });

  it("diaValido", () => {
    expect(diaValido("2026-10-23", AGORA)).toBe("2026-10-23");
    expect(diaValido("2026-11-22", AGORA)).toBe("2026-11-22");
    for (const ruim of ["2026-10-22", "2026-11-23", "2026-02-30", "23/10/2026", "<script>", 5, null]) {
      expect(diaValido(ruim, AGORA)).toBeNull();
    }
  });

  it("diasDisponiveis", () => {
    const d = diasDisponiveis(AGORA);
    expect(d).toHaveLength(31);
    expect(d[0]).toEqual({ valor: "2026-10-23", rotulo: "Hoje" });
    expect(d[1].rotulo).toBe("Amanhã");
    expect(d[2].rotulo).toBe("Dom, 25/10");
  });

  it("horariosDoDia respeita agora: o que começa em ou antes de agora sai", () => {
    // AGORA = sexta 18h30; 18h–19h já começou
    expect(horariosDoDia(sexta, "2026-10-23", AGORA, []).map((x) => x.horario.inicio)).toEqual([1140, 1200, 1260, 1320]);
    // exatamente 19h: o horário das 19h sai
    expect(horariosDoDia(sexta, "2026-10-23", new Date("2026-10-23T22:00:00Z"), []).map((x) => x.horario.inicio)).toEqual([1200, 1260, 1320]);
    // um minuto antes: ainda entra
    expect(horariosDoDia(sexta, "2026-10-23", new Date("2026-10-23T21:59:00Z"), [])[0].horario.inicio).toBe(1140);
    expect(horariosDoDia(sexta, "2026-10-23", new Date("2026-10-24T02:30:00Z"), [])).toEqual([]);
    expect(horariosDoDia(sexta, "2026-10-24", AGORA, [])).toEqual([]); // sábado: nenhum horário
  });

  it("horariosDoDia ordena por início, não mistura dia da semana e marca ocupado", () => {
    const hs = [hor(1, 17 * 60 + 15, 18 * 60), hor(1, 15 * 60 + 30, 17 * 60 + 15), hor(2, 9 * 60, 10 * 60)];
    const livre = horariosDoDia(hs, SEG, AGORA, []);
    expect(livre.map((x) => [x.horario.inicio, x.livre])).toEqual([[930, true], [1035, true]]);
    // reserva 17h–18h toca o horário 15h30–17h15 e o 17h15–18h
    const ocup = horariosDoDia(hs, SEG, AGORA, [periodo("2026-10-26T17:00:00-03:00", "2026-10-26T18:00:00-03:00")]);
    expect(ocup.map((x) => x.livre)).toEqual([false, false]);
    // fim exato = início do horário não toca
    const encosta = horariosDoDia(hs, SEG, AGORA, [periodo("2026-10-26T14:00:00-03:00", "2026-10-26T15:30:00-03:00")]);
    expect(encosta.map((x) => x.livre)).toEqual([true, true]);
    // reserva que vem da véspera e passa da meia-noite ocupa o começo do dia
    const madrug = [hor(1, 0, 60)];
    expect(horariosDoDia(madrug, SEG, AGORA, [periodo("2026-10-25T23:00:00-03:00", "2026-10-26T00:30:00-03:00")])[0].livre).toBe(false);
  });

  it("escolhaDeHorarios soma horários seguidos", () => {
    const e = escolhaDeHorarios(sexta, SEX, 19 * 60, 2, AGORA, []);
    expect(e).toEqual({
      inicio: 1140, fim: 1260,
      itens: [{ inicio: 1140, fim: 1200, precoCentavos: 12000 }, { inicio: 1200, fim: 1260, precoCentavos: 12000 }],
      totalCentavos: 24000,
    });
    expect(escolhaDeHorarios(sexta, SEX, 18 * 60, 1, AGORA, [])?.totalCentavos).toBe(12000);
  });

  it("escolhaDeHorarios recusa qtd fora de 1 a 4 e inteiro", () => {
    for (const qtd of [5, 0, 1.5, -1, Number.NaN]) {
      expect(escolhaDeHorarios(sexta, SEX, 18 * 60, qtd, AGORA, [])).toBeNull();
    }
    expect(escolhaDeHorarios(sexta, SEX, 18 * 60, 4, AGORA, [])?.itens).toHaveLength(4);
  });

  it("escolhaDeHorarios recusa ocupado, buraco, início que não é de horário e passado", () => {
    const ocupado = [periodo("2026-10-30T19:00:00-03:00", "2026-10-30T20:00:00-03:00")];
    expect(escolhaDeHorarios(sexta, SEX, 18 * 60, 2, AGORA, ocupado)).toBeNull(); // o segundo está ocupado
    expect(escolhaDeHorarios(sexta, SEX, 18 * 60, 1, AGORA, ocupado)?.totalCentavos).toBe(12000);
    expect(escolhaDeHorarios(sexta, SEX, 19 * 60, 1, AGORA, ocupado)).toBeNull();
    const buraco = [hor(5, 15 * 60 + 30, 17 * 60 + 15), hor(5, 18 * 60, 19 * 60)];
    expect(escolhaDeHorarios(buraco, SEX, 15 * 60 + 30, 2, AGORA, [])).toBeNull(); // 17h15 → 18h
    expect(escolhaDeHorarios(buraco, SEX, 15 * 60 + 30, 1, AGORA, [])?.fim).toBe(17 * 60 + 15);
    expect(escolhaDeHorarios(sexta, SEX, 18 * 60 + 5, 1, AGORA, [])).toBeNull(); // não é início
    expect(escolhaDeHorarios(sexta, "2026-10-23", 18 * 60, 1, AGORA, [])).toBeNull(); // já começou
  });

  it("escolhaDeHorarios recusa seleção acima de 12 h e aceita exatamente 12 h", () => {
    const longos = [hor(5, 0, 420), hor(5, 420, 840)];
    expect(escolhaDeHorarios(longos, SEX, 0, 2, AGORA, [])).toBeNull(); // 14 h
    const seis = [hor(5, 0, 360), hor(5, 360, 720)];
    expect(escolhaDeHorarios(seis, SEX, 0, 2, AGORA, [])).toMatchObject({ inicio: 0, fim: 720 });
  });

  it("escolhaDeHorarios aceita 23h–24h (fim 1440)", () => {
    const noite = [hor(5, 23 * 60, 1440, 9000)];
    expect(escolhaDeHorarios(noite, SEX, 23 * 60, 1, AGORA, [])).toMatchObject({ inicio: 1380, fim: 1440, totalCentavos: 9000 });
  });
});

describe("instanteDoMinuto e partesDoInstante", () => {
  it("converte minuto local em instante e volta", () => {
    expect(instanteDoMinuto("2026-10-26", 930)).toBe(Date.parse("2026-10-26T15:30:00-03:00"));
    expect(instanteDoMinuto("2026-10-26", 1440)).toBe(Date.parse("2026-10-27T00:00:00-03:00"));
    expect(partesDoInstante(new Date("2026-10-26T15:30:00-03:00"))).toEqual({ dia: "2026-10-26", minuto: 930 });
    expect(partesDoInstante(new Date("2026-10-26T00:00:00-03:00"))).toEqual({ dia: "2026-10-26", minuto: 0 });
  });
});

test("minutoDoFim: meia-noite no fim vale 1440; o resto é o minuto local", () => {
  expect(minutoDoFim(new Date("2026-11-11T03:00:00Z"))).toBe(1440); // 00:00 em São Paulo
  expect(minutoDoFim(new Date("2026-11-10T21:30:00Z"))).toBe(18 * 60 + 30);
});

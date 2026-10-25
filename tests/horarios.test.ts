import { describe, expect, it } from "vitest";
import {
  chocam, gerarFixos, grupoDoDia, minutosDeTexto, primeiroChoque, separarChoques,
  textoIntervalo, textoMinutos, validarHorario,
} from "../app/lib/horarios";

const h = (diaSemana: number, inicio: number, fim: number, precoCentavos = 8000) => ({ diaSemana, inicio, fim, precoCentavos });

describe("minutosDeTexto", () => {
  it("lê HH:MM e recusa o resto", () => {
    expect(minutosDeTexto("15:30")).toBe(930);
    expect(minutosDeTexto("07:00")).toBe(420);
    expect(minutosDeTexto("00:00")).toBe(0);
    expect(minutosDeTexto("00:00", true)).toBe(1440);
    expect(minutosDeTexto("24:00")).toBeNull();
    expect(minutosDeTexto("7:00")).toBeNull();
    expect(minutosDeTexto("15:60")).toBeNull();
    expect(minutosDeTexto("")).toBeNull();
  });
});

describe("textos", () => {
  it("formata minutos e intervalo", () => {
    expect(textoMinutos(420)).toBe("7h");
    expect(textoMinutos(930)).toBe("15h30");
    expect(textoMinutos(1440)).toBe("24h");
    expect(textoMinutos(5)).toBe("0h05");
    expect(textoIntervalo({ inicio: 930, fim: 1035 })).toBe("15h30 – 17h15");
  });
});

describe("validarHorario", () => {
  it("aceita horários válidos", () => {
    expect(validarHorario(h(1, 930, 1035, 11000))).toBeNull();
    expect(validarHorario(h(1, 1380, 1440))).toBeNull();
  });
  it("recusa os inválidos com a mensagem certa", () => {
    expect(validarHorario(h(1, 1380, 1441))).toBe("Fim inválido.");
    expect(validarHorario(h(1, 600, 600))).toBe("O fim deve ser depois do início.");
    expect(validarHorario(h(1, 600, 610))).toBe("Cada horário dura de 15 minutos a 12 horas.");
    expect(validarHorario(h(1, 0, 721))).toBe("Cada horário dura de 15 minutos a 12 horas.");
    expect(validarHorario(h(7, 600, 660))).toBe("Dia da semana inválido.");
    expect(validarHorario(h(1, -5, 60))).toBe("Início inválido.");
    expect(validarHorario(h(1, 600, 660, 0))).toBe("Preço fora do limite permitido.");
  });
});

describe("choques", () => {
  it("chocam só com sobreposição no mesmo dia", () => {
    expect(chocam(h(1, 930, 1035), h(1, 960, 1050))).toBe(true);
    expect(chocam(h(1, 420, 480), h(1, 480, 540))).toBe(false);
    expect(chocam(h(1, 930, 1035), h(2, 960, 1050))).toBe(false);
  });
  it("primeiroChoque acha o conflitante e ignora o próprio id", () => {
    const lista = [{ ...h(1, 600, 660), id: "a" }, { ...h(1, 900, 960), id: "b" }];
    expect(primeiroChoque(h(1, 630, 700), lista)?.id).toBe("a");
    expect(primeiroChoque(h(1, 630, 700), lista, "a")).toBeNull();
    expect(primeiroChoque(h(1, 700, 800), lista)).toBeNull();
  });
});

describe("gerarFixos", () => {
  it("gera passos inteiros", () => {
    const r = gerarFixos({ diaSemana: 1, das: 420, ate: 1320, duracao: 60, precoCentavos: 8000 });
    expect(r).toHaveLength(15);
    expect(r[0]).toEqual(h(1, 420, 480));
    expect(r[14]).toEqual(h(1, 1260, 1320));
  });
  it("descarta o resto que não fecha um horário", () => {
    expect(gerarFixos({ diaSemana: 1, das: 420, ate: 500, duracao: 60, precoCentavos: 8000 })).toEqual([h(1, 420, 480)]);
  });
  it("das >= ate não gera nada", () => {
    expect(gerarFixos({ diaSemana: 1, das: 600, ate: 600, duracao: 60, precoCentavos: 8000 })).toEqual([]);
  });
});

describe("separarChoques", () => {
  it("pula os que chocam com os existentes", () => {
    const novos = gerarFixos({ diaSemana: 1, das: 420, ate: 1320, duracao: 60, precoCentavos: 8000 });
    const { criar, pulados } = separarChoques(novos, [h(1, 930, 1035)]);
    expect(pulados.map((p) => [p.inicio, p.fim])).toEqual([[900, 960], [960, 1020], [1020, 1080]]);
    expect(criar).toHaveLength(12);
  });
});

describe("grupoDoDia", () => {
  it("agrupa por início", () => {
    expect(grupoDoDia(719)).toBe("madrugada e manhã");
    expect(grupoDoDia(720)).toBe("tarde");
    expect(grupoDoDia(1080)).toBe("noite");
  });
});

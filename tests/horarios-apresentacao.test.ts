import { describe, expect, test } from "vitest";
import { avisoReservas, contagemPorDia, resumoLote } from "@/app/painel/quadras/[id]/horarios-apresentacao";

const h = (diaSemana: number) => ({ id: `h${Math.random()}`, diaSemana, inicio: 420, fim: 480, precoCentavos: 8000 });

describe("contagemPorDia", () => {
  test("conta por dia da semana, índice 0 = domingo", () => {
    expect(contagemPorDia([h(1), h(1), h(0), h(6)])).toEqual([1, 2, 0, 0, 0, 0, 1]);
  });
  test("sem horários, sete zeros", () => {
    expect(contagemPorDia([])).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("avisoReservas", () => {
  test("0 reservas, sem aviso", () => {
    expect(avisoReservas(0)).toBeNull();
  });
  test("1 reserva, singular", () => {
    expect(avisoReservas(1)).toBe("Esse horário tem 1 reserva futura; ela continua valendo como foi feita.");
  });
  test("3 reservas, plural", () => {
    expect(avisoReservas(3)).toBe("Esse horário tem 3 reservas futuras; elas continuam valendo como foram feitas.");
  });
});

describe("resumoLote", () => {
  test("vários criados", () => {
    expect(resumoLote(12, 0)).toBe("12 horários criados.");
  });
  test("um criado", () => {
    expect(resumoLote(1, 0)).toBe("1 horário criado.");
  });
  test("com pulados", () => {
    expect(resumoLote(12, 3)).toBe("12 horários criados; 3 chocavam com os existentes e foram pulados.");
  });
  test("nenhum criado", () => {
    expect(resumoLote(0, 5)).toBe("Nenhum horário criado: todos chocavam com os existentes.");
  });
});

import { precoParaCampo, rotuloDuracao, valorHora } from "@/app/painel/quadras/[id]/horarios-apresentacao";

describe("campos", () => {
  test("valorHora", () => {
    expect(valorHora(420)).toBe("07:00");
    expect(valorHora(945)).toBe("15:45");
    expect(valorHora(1440)).toBe("00:00");
  });
  test("precoParaCampo", () => {
    expect(precoParaCampo(8000)).toBe("80,00");
    expect(precoParaCampo(8050)).toBe("80,50");
  });
  test("rotuloDuracao", () => {
    expect([30, 45, 60, 90, 120].map(rotuloDuracao)).toEqual(["30 min", "45 min", "1 hora", "1h30", "2 horas"]);
  });
});

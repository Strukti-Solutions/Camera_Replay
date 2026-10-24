import { describe, expect, it } from "vitest";
import { diaDaSemana, diaValido, diasDisponiveis, hojeLocal, iniciosLivres, precoEscolha } from "../app/lib/disponibilidade";
import type { Faixa } from "../app/lib/precos";

const AGORA = new Date("2026-10-23T21:30:00Z"); // sexta 18h30 em São Paulo
const sexta: Faixa[] = [
  { diaSemana: 5, inicio: 7, fim: 17, precoCentavos: 8000 },
  { diaSemana: 5, inicio: 17, fim: 23, precoCentavos: 12000 },
];

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

  it("iniciosLivres respeita agora", () => {
    expect(iniciosLivres(sexta, "2026-10-23", AGORA)).toEqual([
      { hora: 19, horasMax: 4 }, { hora: 20, horasMax: 3 }, { hora: 21, horasMax: 2 }, { hora: 22, horasMax: 1 },
    ]);
    expect(iniciosLivres(sexta, "2026-10-23", new Date("2026-10-23T20:59:00Z"))[0].hora).toBe(18);
    expect(iniciosLivres(sexta, "2026-10-23", new Date("2026-10-23T21:00:00Z"))[0].hora).toBe(19);
    expect(iniciosLivres(sexta, "2026-10-23", new Date("2026-10-24T02:30:00Z"))).toEqual([]);
    expect(iniciosLivres(sexta, "2026-10-24", AGORA)).toEqual([]);
  });

  it("faixas encostadas são contínuas e o preço é por hora", () => {
    const sab: Faixa[] = [
      { diaSemana: 6, inicio: 7, fim: 17, precoCentavos: 8000 },
      { diaSemana: 6, inicio: 17, fim: 23, precoCentavos: 12000 },
    ];
    const e = precoEscolha(sab, "2026-10-24", 16, 2, AGORA);
    expect(e).toMatchObject({ totalCentavos: 20000, porHora: [{ hora: 16, precoCentavos: 8000 }, { hora: 17, precoCentavos: 12000 }] });
  });

  it("horas além do contínuo", () => {
    expect(precoEscolha(sexta, "2026-10-30", 21, 4, AGORA)).toBeNull();
    expect(precoEscolha(sexta, "2026-10-30", 21, 2, AGORA)?.totalCentavos).toBe(24000);
    expect(precoEscolha(sexta, "2026-10-30", 21, 0, AGORA)).toBeNull();
  });

  it("buraco na tabela corta a continuidade", () => {
    const f: Faixa[] = [
      { diaSemana: 5, inicio: 7, fim: 12, precoCentavos: 8000 },
      { diaSemana: 5, inicio: 14, fim: 18, precoCentavos: 8000 },
    ];
    expect(iniciosLivres(f, "2026-10-30", AGORA).find((i) => i.hora === 11)?.horasMax).toBe(1);
  });
});

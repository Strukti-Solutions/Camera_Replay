import { expect, test } from "vitest";
import { linkComoChegar, lerEscolha, textoDia, textoLances } from "../app/a/[slug]/apresentacao";

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
  expect(lerEscolha({}, ids, agora)).toEqual({ quadra: null, dia: "2026-10-17", inicio: null, horas: 1 });
  expect(
    lerEscolha({ quadra: "q9", dia: "<script>", inicio: "abc", horas: "10" }, ids, agora),
  ).toEqual({ quadra: null, dia: "2026-10-17", inicio: null, horas: 1 });
  expect(lerEscolha({ quadra: "q2", dia: "2026-10-20", inicio: "16", horas: "2" }, ids, agora)).toEqual({
    quadra: "q2",
    dia: "2026-10-20",
    inicio: 16,
    horas: 2,
  });
  expect(lerEscolha({ inicio: "24", horas: "0" }, ids, agora)).toMatchObject({ inicio: null, horas: 1 });
  expect(lerEscolha({ inicio: "7.5", horas: "2.5" }, ids, agora)).toMatchObject({ inicio: null, horas: 1 });
  expect(
    lerEscolha({ quadra: ["q1", "q2"], dia: ["2026-10-18", "x"], inicio: ["8", "9"], horas: ["3", "1"] }, ids, agora),
  ).toEqual({ quadra: "q1", dia: "2026-10-18", inicio: 8, horas: 3 });
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

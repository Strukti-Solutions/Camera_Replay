import { expect, test, vi } from "vitest";
import { criarGeocodificador } from "../app/lib/geocodificar";

const resp = (corpo: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;

test("consulta o Nominatim com os parâmetros e o User-Agent combinados", async () => {
  const fetcher = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => resp([{ lat: "-3.73", lon: "-38.52" }]));
  const g = criarGeocodificador(fetcher as unknown as typeof fetch);
  expect(await g("Rua A, 10, Centro")).toEqual({ latitude: -3.73, longitude: -38.52 });
  const url = String(fetcher.mock.calls[0][0]);
  expect(url).toContain("https://nominatim.openstreetmap.org/search?");
  expect(url).toContain("format=jsonv2");
  expect(url).toContain("limit=1");
  expect(url).toContain("countrycodes=br");
  expect(url).toContain("q=" + encodeURIComponent("Rua A, 10, Centro"));
  const init = fetcher.mock.calls[0][1] as RequestInit;
  expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
    "Replay-Strukti/1.0 (struktisolutions@gmail.com)");
  expect(init.signal).toBeDefined();
});

test("sem resultado, erro HTTP ou exceção devolvem null", async () => {
  expect(await criarGeocodificador((async () => resp([])) as unknown as typeof fetch)("x")).toBeNull();
  expect(await criarGeocodificador((async () => resp([], 500)) as unknown as typeof fetch)("x")).toBeNull();
  expect(await criarGeocodificador((async () => { throw new Error("rede"); }) as unknown as typeof fetch)("x")).toBeNull();
  expect(await criarGeocodificador((async () => resp([{ lat: "abc", lon: "1" }])) as unknown as typeof fetch)("x")).toBeNull();
});

test("lat/lon vazios, nulos ou fora do intervalo devolvem null", async () => {
  for (const item of [{ lat: "", lon: "1" }, { lat: null, lon: "1" }, { lat: "95", lon: "1" }, { lat: "1", lon: "181" }]) {
    expect(await criarGeocodificador((async () => resp([item])) as unknown as typeof fetch)("x")).toBeNull();
  }
});

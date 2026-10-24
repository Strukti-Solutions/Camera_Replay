export type Coordenadas = { latitude: number; longitude: number };
export type Geocodificar = (endereco: string) => Promise<Coordenadas | null>;

const URL_BASE = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Replay-Strukti/1.0 (struktisolutions@gmail.com)";

// Nominatim: uma consulta por endereço salvo. Nunca lança: qualquer falha vira null.
export function criarGeocodificador(fetcher: typeof fetch = fetch): Geocodificar {
  return async (endereco) => {
    try {
      const url = `${URL_BASE}?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(endereco)}`;
      const r = await fetcher(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return null;
      const lista = (await r.json()) as unknown;
      if (!Array.isArray(lista) || lista.length === 0) return null;
      const latitude = Number(lista[0]?.lat);
      const longitude = Number(lista[0]?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    } catch {
      return null;
    }
  };
}

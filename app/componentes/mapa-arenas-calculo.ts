// Enquadramento do mapa da home, sem Leaflet (testável no Node).

export type PontoArena = { nome: string; slug: string; latitude: number; longitude: number };

export type LatLng = [number, number];

export type Limites = { centro: LatLng; zoom: number } | { bounds: [LatLng, LatLng] };

export const ZOOM_UM_PONTO = 14;

export const valido = (p: PontoArena) =>
  Number.isFinite(p.latitude) &&
  Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 90 &&
  Math.abs(p.longitude) <= 180;

// Nenhum ponto válido → null (o mapa não aparece); um lugar só → centro com
// zoom 14; vários → a caixa que cabe todos (o Leaflet aplica com fitBounds).
export function limitesDoMapa(pontos: PontoArena[]): Limites | null {
  const ok = pontos.filter(valido);
  if (ok.length === 0) return null;
  const lats = ok.map((p) => p.latitude);
  const lngs = ok.map((p) => p.longitude);
  const sul = Math.min(...lats);
  const norte = Math.max(...lats);
  const oeste = Math.min(...lngs);
  const leste = Math.max(...lngs);
  if (sul === norte && oeste === leste) return { centro: [sul, oeste], zoom: ZOOM_UM_PONTO };
  return {
    bounds: [
      [sul, oeste],
      [norte, leste],
    ],
  };
}

// Nó mínimo do DOM para achar o que fica atrás da tela cheia (testável no Node).
export type NoArvore = { parentElement: NoArvore | null; children: ArrayLike<NoArvore> };

// Do mapa até o <body>, todo irmão de um ancestral (ou do próprio mapa) fica
// atrás do overlay e precisa de `inert`. O mapa e seus ancestrais ficam de fora.
export function irmaosAtrasDoMapa<T extends NoArvore>(mapa: T, corpo: T): T[] {
  const lista: T[] = [];
  let atual: NoArvore = mapa;
  while (atual !== corpo && atual.parentElement) {
    const pai: NoArvore = atual.parentElement;
    for (let i = 0; i < pai.children.length; i++) {
      if (pai.children[i] !== atual) lista.push(pai.children[i] as T);
    }
    atual = pai;
  }
  return lista;
}

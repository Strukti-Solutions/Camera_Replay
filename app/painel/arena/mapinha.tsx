"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
// Texto fixo (não vem de dado de arena), então pode ir como HTML.
const ATRIBUICAO = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Mapinha do painel: mostra onde a arena aparece para os jogadores. É extra:
// sem JavaScript fica só o texto, e o resto da tela funciona.
export function MapinhaArena({ latitude, longitude, nome }: { latitude: number; longitude: number; nome: string }) {
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const div = area.current;
    if (!div) return;
    let cancelado = false;
    let mapa: { remove: () => void } | null = null;
    import("leaflet").then((mod) => {
      if (cancelado) return;
      const L = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const m = L.map(div, { scrollWheelZoom: false }).setView([latitude, longitude], 16);
      L.tileLayer(TILES, {
        attribution: ATRIBUICAO,
        maxZoom: 19,
        // O site manda no-referrer; os tiles do OSM pedem o Referer (só a origem vai).
        referrerPolicy: "strict-origin-when-cross-origin",
      }).addTo(m);
      // Pino sem texto, montado com DOM: nada de dado vira HTML.
      const pino = document.createElement("span");
      pino.className = "mapa-pino mapa-pino-vazio";
      L.marker([latitude, longitude], {
        icon: L.divIcon({ html: pino, className: "mapa-pino-caixa", iconSize: [0, 0] }),
        title: nome,
        keyboard: false,
      }).addTo(m);
      mapa = m;
    });
    return () => {
      cancelado = true;
      mapa?.remove();
    };
  }, [latitude, longitude, nome]);

  return <div ref={area} className="ar-mapinha" />;
}

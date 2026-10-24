"use client";

import "leaflet/dist/leaflet.css";
import type { Map as MapaLeaflet } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { irmaosAtrasDoMapa, limitesDoMapa, valido, type PontoArena } from "./mapa-arenas-calculo";

const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
// Texto fixo (não vem de dado de arena), então pode ir como HTML.
const ATRIBUICAO = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Conteúdo do popup montado com DOM e textContent: o nome da arena nunca vira HTML.
function popupDaArena(p: PontoArena): HTMLElement {
  const caixa = document.createElement("div");
  caixa.className = "mapa-popup";
  const nome = document.createElement("strong");
  nome.textContent = p.nome;
  const link = document.createElement("a");
  link.href = `/a/${encodeURIComponent(p.slug)}`;
  link.textContent = "Ver arena";
  caixa.append(nome, link);
  return caixa;
}

// Mapa das arenas da home: 240 px abaixo da busca e "Ver no mapa" para a tela
// inteira. É extra: sem JavaScript não aparece (nada é renderizado no
// servidor) e a lista de resultados continua sendo o caminho principal.
export function MapaArenas({ pontos }: { pontos: PontoArena[] }) {
  const limites = useMemo(() => limitesDoMapa(pontos), [pontos]);
  const [montado, setMontado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const secao = useRef<HTMLElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLeaflet | null>(null);
  const botaoVer = useRef<HTMLButtonElement>(null);
  const botaoFechar = useRef<HTMLButtonElement>(null);
  const jaAbriu = useRef(false);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!montado || !limites || !area.current) return;
    let cancelado = false;
    const div = area.current;
    import("leaflet").then((mod) => {
      if (cancelado) return;
      const L = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const m = L.map(div, { scrollWheelZoom: false });
      L.tileLayer(TILES, {
        attribution: ATRIBUICAO,
        maxZoom: 19,
        // O site manda no-referrer; os tiles do OSM pedem o Referer (só a origem vai).
        referrerPolicy: "strict-origin-when-cross-origin",
      }).addTo(m);
      for (const p of pontos) {
        if (!valido(p)) continue;
        L.circleMarker([p.latitude, p.longitude], {
          radius: 11,
          weight: 3,
          fillOpacity: 1,
          className: "mapa-ponto",
        })
          .bindPopup(popupDaArena(p))
          .addTo(m);
      }
      if ("centro" in limites) m.setView(limites.centro, limites.zoom);
      else m.fitBounds(limites.bounds, { padding: [24, 24], maxZoom: 15 });
      mapa.current = m;
    });
    return () => {
      cancelado = true;
      mapa.current?.remove();
      mapa.current = null;
    };
  }, [montado, limites, pontos]);

  // Troca de tamanho: o Leaflet precisa recalcular; o foco vai e volta com a tela cheia.
  useEffect(() => {
    if (!montado) return;
    const quadro = requestAnimationFrame(() => mapa.current?.invalidateSize());
    if (aberto) {
      jaAbriu.current = true;
      botaoFechar.current?.focus();
      document.documentElement.classList.add("mapa-tela-cheia");
      // Atrás do overlay nada recebe foco (WCAG 2.4.11): só marca o que ainda não era inert.
      const atras = secao.current
        ? irmaosAtrasDoMapa<Element>(secao.current, document.body).filter((el) => !el.hasAttribute("inert"))
        : [];
      for (const el of atras) el.setAttribute("inert", "");
      const esc = (e: globalThis.KeyboardEvent) => {
        if (e.key === "Escape") setAberto(false);
      };
      document.addEventListener("keydown", esc);
      return () => {
        cancelAnimationFrame(quadro);
        document.removeEventListener("keydown", esc);
        for (const el of atras) el.removeAttribute("inert");
        document.documentElement.classList.remove("mapa-tela-cheia");
      };
    }
    if (jaAbriu.current) botaoVer.current?.focus();
    return () => cancelAnimationFrame(quadro);
  }, [aberto, montado]);

  if (!montado || !limites) return null;

  return (
    <section ref={secao} className={aberto ? "mapa-arenas aberto" : "mapa-arenas"} aria-label="Mapa das arenas">
      <div className="mapa-barra" hidden={!aberto}>
        <button ref={botaoFechar} type="button" className="botao" onClick={() => setAberto(false)}>
          Fechar mapa
        </button>
      </div>
      <div ref={area} className="mapa-area" />
      <button
        ref={botaoVer}
        type="button"
        className="botao mapa-ver"
        hidden={aberto}
        onClick={() => setAberto(true)}
      >
        Ver no mapa
      </button>
    </section>
  );
}

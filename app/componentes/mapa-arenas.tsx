"use client";

import "leaflet/dist/leaflet.css";
import type { Map as MapaLeaflet, Marker } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { irmaosAtrasDoMapa, limitesDoMapa, valido, type PontoArena } from "./mapa-arenas-calculo";

const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
// Texto fixo (não vem de dado de arena), então pode ir como HTML.
const ATRIBUICAO = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Ponto do mapa com o que o card de baixo mostra.
export type PontoMapa = PontoArena & {
  pino: string; // "R$ 80" ou "" (sem preço: só a bolinha)
  local: string | null;
  preco: string; // "a partir de R$ 80,00/h"
  foto: string | null;
};

// Pino com o preço, montado com DOM e textContent: nada de dado vira HTML.
function pinoDaArena(p: PontoMapa): HTMLElement {
  const el = document.createElement("span");
  el.className = p.pino ? "mapa-pino" : "mapa-pino mapa-pino-vazio";
  el.textContent = p.pino;
  return el;
}

// Mapa das arenas da home. É extra: sem JavaScript não aparece e a lista
// continua sendo o caminho principal.
// - Computador: coluna da direita, sempre aberto; passar o mouse (ou focar)
//   num card com `data-arena` destaca o pino.
// - Celular: botão flutuante "Ver no mapa" abre a tela cheia.
// Tocar num pino mostra o card da arena embaixo do mapa.
export function MapaArenas({ pontos }: { pontos: PontoMapa[] }) {
  const limites = useMemo(() => limitesDoMapa(pontos), [pontos]);
  const [montado, setMontado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState<PontoMapa | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  const secao = useRef<HTMLElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLeaflet | null>(null);
  const pinos = useRef(new Map<string, Marker>());
  const botaoVer = useRef<HTMLButtonElement>(null);
  const botaoFechar = useRef<HTMLButtonElement>(null);
  const jaAbriu = useRef(false);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!montado || !limites || !area.current) return;
    let cancelado = false;
    const div = area.current;
    const lista = pinos.current;
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
        const pino = L.marker([p.latitude, p.longitude], {
          icon: L.divIcon({ html: pinoDaArena(p), className: "mapa-pino-caixa", iconSize: [0, 0] }),
          title: p.nome,
          keyboard: true,
        })
          .on("click", () => setEscolhido(p))
          .addTo(m);
        lista.set(p.slug, pino);
      }
      if ("centro" in limites) m.setView(limites.centro, limites.zoom);
      else m.fitBounds(limites.bounds, { padding: [32, 32], maxZoom: 15 });
      mapa.current = m;
    });
    return () => {
      cancelado = true;
      lista.clear();
      mapa.current?.remove();
      mapa.current = null;
    };
  }, [montado, limites, pontos]);

  // Card da lista sob o mouse ou com o foco → pino em destaque.
  useEffect(() => {
    const achar = (e: Event) => (e.target as Element | null)?.closest?.("[data-arena]")?.getAttribute("data-arena") ?? null;
    const entrar = (e: Event) => setDestaque(achar(e));
    const sair = () => setDestaque(null);
    document.addEventListener("pointerover", entrar);
    document.addEventListener("focusin", entrar);
    document.addEventListener("focusout", sair);
    return () => {
      document.removeEventListener("pointerover", entrar);
      document.removeEventListener("focusin", entrar);
      document.removeEventListener("focusout", sair);
    };
  }, []);

  useEffect(() => {
    for (const [slug, pino] of pinos.current) {
      const el = pino.getElement();
      el?.classList.toggle("mapa-pino-destaque", slug === destaque);
      pino.setZIndexOffset(slug === destaque ? 1000 : 0);
    }
  }, [destaque]);

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
          ← Voltar à lista
        </button>
      </div>
      <div className="mapa-palco">
        <div ref={area} className="mapa-area" />
        {escolhido && (
          <div className="mapa-cartao" role="group" aria-label={escolhido.nome}>
            {escolhido.foto ? (
              // eslint-disable-next-line @next/next/no-img-element -- rota própria, já com cache
              <img src={`/fotos/${escolhido.foto}`} alt="" />
            ) : (
              <span className="mapa-cartao-sem-foto" aria-hidden="true" />
            )}
            <span className="mapa-cartao-texto">
              <strong>{escolhido.nome}</strong>
              {escolhido.local && <span className="suave">{escolhido.local}</span>}
              <span className="mapa-cartao-preco">{escolhido.preco}</span>
              <a href={`/a/${encodeURIComponent(escolhido.slug)}`}>Ver horários ›</a>
            </span>
            <button type="button" className="mapa-cartao-fechar" aria-label="Fechar" onClick={() => setEscolhido(null)}>
              ×
            </button>
          </div>
        )}
      </div>
      <button ref={botaoVer} type="button" className="botao botao-cheio mapa-ver" hidden={aberto} onClick={() => setAberto(true)}>
        Ver no mapa
      </button>
    </section>
  );
}

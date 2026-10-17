"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  PERSPECTIVA,
  VAO,
  alvoMaisCurto,
  arremesso,
  deslocamento,
  foiArraste,
  indiceEm,
  limitar,
  poseDoCartao,
  usaLoop,
} from "./coverflow";
import { VideoClipe } from "./video-clipe";

// Textos já formatados no servidor: evita divergência de "hoje/ontem" entre
// o relógio do servidor e o do celular na hidratação.
export type LanceDoCarrossel = {
  id: string;
  horario: string;
  duracao: string;
  parcial: boolean;
  url: string;
  capa: string;
  download: string;
};

// Só desenha no navegador. Sem JavaScript quem aparece é a lista do
// <noscript>; assim a página nunca mostra cartões empilhados sem posição.
const nadaAssinar = () => () => {};
function useNoNavegador() {
  return useSyncExternalStore(nadaAssinar, () => true, () => false);
}

function prefereMenosMovimento() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Arraste = {
  id: number;
  x0: number;
  y0: number;
  pos: number;
  v: number;
  t: number;
  arrastando: boolean;
};

export function CarrosselLances({ lances }: { lances: LanceDoCarrossel[] }) {
  const total = lances.length;
  const loop = usaLoop(total);
  const noNavegador = useNoNavegador();

  const cartoesRef = useRef<(HTMLDivElement | null)[]>([]);
  const botoesRef = useRef<(HTMLButtonElement | null)[]>([]);
  const dialogoRef = useRef<HTMLDialogElement>(null);
  // Índice fracionário do cartão no centro: a única fonte da verdade.
  const posRef = useRef(0);
  // Para onde a acomodação atual vai. Passos do teclado partem daqui, senão
  // uma tecla no meio da animação seria engolida.
  const alvoRef = useRef(0);
  const larguraRef = useRef(0);
  const quadroRef = useRef<number | null>(null);
  const arrasteRef = useRef<Arraste | null>(null);
  // O último gesto foi arraste: o clique que vier dele não abre o lance.
  const moveuRef = useRef(false);

  const [selecionado, setSelecionado] = useState(0);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [semCapa, setSemCapa] = useState<ReadonlySet<string>>(new Set());

  cartoesRef.current.length = total;
  botoesRef.current.length = total;

  // Pinta direto no DOM: 60 atualizações de estado por segundo fariam o React
  // redesenhar todos os cartões por números que ele não precisa ver.
  const pintar = useCallback(() => {
    const largura = larguraRef.current;
    if (!largura) return;
    cartoesRef.current.forEach((cartao, i) => {
      if (!cartao) return;
      const p = poseDoCartao(deslocamento(i, posRef.current, total, loop), largura, total, loop);
      cartao.style.transform =
        `translateX(calc(-50% + ${p.x}px)) translateZ(${p.z}px) rotateY(${p.giro}deg)`;
      cartao.style.opacity = String(p.opacidade);
      cartao.style.zIndex = String(p.camada);
      // Invisível também não recebe toque.
      cartao.style.visibility = p.opacidade === 0 ? "hidden" : "";
    });
  }, [total, loop]);

  const parar = () => {
    if (quadroRef.current !== null) cancelAnimationFrame(quadroRef.current);
    quadroRef.current = null;
  };

  const acomodar = useCallback(
    (alvo: number) => {
      parar();
      alvoRef.current = alvo;
      setSelecionado(indiceEm(alvo, total));

      // Movimento reduzido: salto direto, sem animação.
      if (prefereMenosMovimento()) {
        posRef.current = alvo;
        pintar();
        return;
      }
      const passo = () => {
        const falta = alvo - posRef.current;
        if (Math.abs(falta) < 0.0004) {
          posRef.current = alvo;
          pintar();
          quadroRef.current = null;
          return;
        }
        // Desaceleração exponencial, sem mola.
        posRef.current += falta * 0.16;
        pintar();
        quadroRef.current = requestAnimationFrame(passo);
      };
      quadroRef.current = requestAnimationFrame(passo);
    },
    [total, pintar],
  );

  const irPara = (indice: number) =>
    acomodar(limitar(alvoMaisCurto(indice, alvoRef.current, total, loop), total, loop));

  const andar = (passos: number) => {
    const alvo = limitar(Math.round(alvoRef.current) + passos, total, loop);
    acomodar(alvo);
    return indiceEm(alvo, total);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    parar();
    alvoRef.current = posRef.current;
    moveuRef.current = false;
    arrasteRef.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      pos: posRef.current,
      v: 0,
      t: performance.now(),
      arrastando: false,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const a = arrasteRef.current;
    if (!a || a.id !== e.pointerId) return;
    if (!a.arrastando) {
      // Abaixo do limiar é toque: o clique segue para o cartão.
      if (!foiArraste(e.clientX - a.x0, e.clientY - a.y0)) return;
      a.arrastando = true;
      moveuRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const passo = larguraRef.current * (1 + VAO);
    if (!passo) return;

    const agora = performance.now();
    const antes = posRef.current;
    posRef.current = limitar(a.pos - (e.clientX - a.x0) / passo, total, loop);
    // Cartões por segundo, para a inércia.
    a.v = ((posRef.current - antes) / Math.max(agora - a.t, 1)) * 1000;
    a.t = agora;

    const indice = indiceEm(posRef.current, total);
    if (indice !== selecionado) setSelecionado(indice);
    pintar();
  };

  const fimDoArraste = (e: PointerEvent<HTMLDivElement>) => {
    const a = arrasteRef.current;
    if (!a || a.id !== e.pointerId) return;
    arrasteRef.current = null;
    // Um peteleco ainda carrega, mas nunca mais de dois cartões.
    const inercia = a.arrastando ? arremesso(a.v) : 0;
    acomodar(limitar(Math.round(posRef.current + inercia), total, loop));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const novo = andar(e.key === "ArrowLeft" ? -1 : 1);
    // O foco acompanha o cartão do centro (o único com tabIndex 0).
    botoesRef.current[novo]?.focus({ preventScroll: true });
  };

  const tocarCartao = (indice: number, id: string, e: MouseEvent<HTMLButtonElement>) => {
    // detail 0 = clique vindo do teclado (Enter/Espaço), nunca de arraste.
    if (e.detail !== 0 && moveuRef.current) {
      moveuRef.current = false;
      return;
    }
    if (indice !== selecionado) irPara(indice);
    else setAbertoId(id);
  };

  // A largura do cartão define passo, recuo e perspectiva: mede só quando a
  // caixa muda de fato.
  useLayoutEffect(() => {
    if (!noNavegador) return;
    const medir = () => {
      const cartao = cartoesRef.current[0];
      if (!cartao) return;
      larguraRef.current = cartao.offsetWidth;
      pintar();
    };
    medir();
    const observador = new ResizeObserver(medir);
    if (cartoesRef.current[0]?.parentElement) observador.observe(cartoesRef.current[0].parentElement);
    return () => observador.disconnect();
  }, [noNavegador, pintar]);

  // Lista mudou (Atualizar lista ou renovação de link): mantém o centro válido.
  useEffect(() => {
    if (!total) return;
    const alvo = limitar(Math.round(alvoRef.current), total, loop);
    posRef.current = alvoRef.current = alvo;
    setSelecionado(indiceEm(alvo, total));
    pintar();
  }, [total, loop, pintar]);

  useEffect(() => () => parar(), []);

  const aberto = abertoId ? lances.find((l) => l.id === abertoId) : undefined;

  // Abre o diálogo depois que o conteúdo do lance já está no DOM; fecha se o
  // lance sumiu da lista (expirou) enquanto estava aberto.
  useEffect(() => {
    const dialogo = dialogoRef.current;
    if (!dialogo) return;
    if (aberto && !dialogo.open) dialogo.showModal();
    if (!aberto && dialogo.open) dialogo.close();
  }, [aberto]);

  const aoFechar = () => {
    dialogoRef.current?.querySelector("video")?.pause();
    const indice = lances.findIndex((l) => l.id === abertoId);
    setAbertoId(null);
    botoesRef.current[indice >= 0 ? indice : selecionado]?.focus({ preventScroll: true });
  };

  if (!noNavegador || total === 0) return null;

  const atual = lances[Math.min(selecionado, total - 1)];
  const comSetas = total > 1;

  return (
    <section className="carrossel" aria-roledescription="carrossel" aria-label="Lances">
      <div className="carrossel-palco">
        <div
          className="carrossel-quadro"
          style={{ perspective: `calc(var(--cartao-lance) * ${PERSPECTIVA})` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={fimDoArraste}
          onPointerCancel={fimDoArraste}
          onKeyDown={onKeyDown}
        >
          <div className="carrossel-trilho">
            {lances.map((lance, i) => {
              const rotulo = `Lance de ${lance.horario}`;
              const falhou = !lance.capa || semCapa.has(lance.id);
              return (
                <div
                  key={lance.id}
                  ref={(no) => {
                    cartoesRef.current[i] = no;
                  }}
                  className="cartao-lance"
                  role="group"
                  aria-label={`Lance ${i + 1} de ${total}`}
                >
                  <button
                    type="button"
                    ref={(no) => {
                      botoesRef.current[i] = no;
                    }}
                    tabIndex={i === selecionado ? 0 : -1}
                    onClick={(e) => tocarCartao(i, lance.id, e)}
                  >
                    {falhou ? (
                      <span className="capa-vazia">
                        <IconePlay />
                        <span className="so-leitor">{rotulo}</span>
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={lance.capa}
                        alt={rotulo}
                        width={640}
                        height={360}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        onError={() => setSemCapa((s) => new Set(s).add(lance.id))}
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {comSetas && (
          <>
            <button
              type="button"
              className="carrossel-seta carrossel-seta-anterior"
              aria-label="Lance anterior"
              // aria-disabled em vez de disabled: o foco não cai no vazio na ponta.
              aria-disabled={!loop && selecionado === 0}
              onClick={() => andar(-1)}
            >
              <IconeSeta direcao="anterior" />
            </button>
            <button
              type="button"
              className="carrossel-seta carrossel-seta-proxima"
              aria-label="Próximo lance"
              aria-disabled={!loop && selecionado === total - 1}
              onClick={() => andar(1)}
            >
              <IconeSeta direcao="proxima" />
            </button>
          </>
        )}
      </div>

      <div className="carrossel-legenda miolo" aria-live="polite">
        <p className="carrossel-horario">{atual.horario}</p>
        <p className="lance-meta">
          <span>{atual.duracao}</span>
          {atual.parcial && <span className="selo">Parcial</span>}
        </p>
      </div>

      <dialog
        ref={dialogoRef}
        className="lance-dialogo"
        aria-labelledby="lance-dialogo-titulo"
        onClose={aoFechar}
        onClick={(e) => {
          // Clique no fundo (fora da caixa) fecha.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        {aberto && (
          <div className="lance-dialogo-caixa">
            <div className="lance-dialogo-topo">
              <div className="lance-cabeca">
                <h2 id="lance-dialogo-titulo">{aberto.horario}</h2>
                <p className="lance-meta">
                  <span>{aberto.duracao}</span>
                  {aberto.parcial && <span className="selo">Parcial</span>}
                </p>
              </div>
              <button
                type="button"
                className="botao"
                onClick={() => dialogoRef.current?.close()}
              >
                Fechar
              </button>
            </div>
            <VideoClipe key={aberto.id} url={aberto.url} rotulo={`Lance de ${aberto.horario}`} autoPlay />
            <a className="botao botao-cheio" href={aberto.download}>
              Baixar vídeo
            </a>
          </div>
        )}
      </dialog>
    </section>
  );
}

function IconePlay() {
  return (
    <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M19 15.5v17l14-8.5z" fill="currentColor" />
    </svg>
  );
}

function IconeSeta({ direcao }: { direcao: "anterior" | "proxima" }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path
        d={direcao === "anterior" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

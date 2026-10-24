"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

type Sugestao = { nome: string; slug: string; cidade: string | null };

const ESPERA_MS = 250;
const MINIMO = 2;
const MAXIMO = 8;

const linkDaArena = (slug: string) => `/a/${encodeURIComponent(slug)}`;

// Busca da home. É um formulário GET comum (?busca=) que funciona sem
// JavaScript; com JavaScript, o campo vira um combobox com até 8 sugestões de
// /api/arenas/sugestoes depois de 2 caracteres. Enter sem sugestão ativa envia
// o formulário normalmente.
export function BuscaArenas({ busca }: { busca: string }) {
  const router = useRouter();
  const id = useId();
  const idLista = `${id}-lista`;
  const idOpcao = (i: number) => `${id}-opcao-${i}`;

  const [termo, setTermo] = useState(busca);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  // Só consulta depois que a pessoa digita: o termo que veio na URL não abre a lista.
  const digitou = useRef(false);
  const pedido = useRef<AbortController | null>(null);
  const fechar = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!digitou.current) return;
    const t = termo.trim();
    if (t.length < MINIMO) {
      pedido.current?.abort();
      setSugestoes([]);
      setAberto(false);
      setAtivo(-1);
      return;
    }
    const espera = setTimeout(() => {
      pedido.current?.abort();
      const controle = new AbortController();
      pedido.current = controle;
      fetch(`/api/arenas/sugestoes?q=${encodeURIComponent(t)}`, { signal: controle.signal })
        .then((r) => (r.ok ? r.json() : { arenas: [] }))
        .then((dados: { arenas?: Sugestao[] }) => {
          const lista = Array.isArray(dados.arenas) ? dados.arenas.slice(0, MAXIMO) : [];
          setSugestoes(lista);
          setAtivo(-1);
          setAberto(lista.length > 0);
        })
        .catch(() => {
          // Pedido cancelado ou rede fora: as sugestões são extra, a busca segue.
        });
    }, ESPERA_MS);
    return () => clearTimeout(espera);
  }, [termo]);

  useEffect(
    () => () => {
      pedido.current?.abort();
      if (fechar.current) clearTimeout(fechar.current);
    },
    [],
  );

  const ir = (s: Sugestao) => {
    setAberto(false);
    router.push(linkDaArena(s.slug));
  };

  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = sugestoes.length;
    if (e.key === "ArrowDown" && n > 0) {
      e.preventDefault();
      setAberto(true);
      setAtivo((a) => (a + 1) % n);
    } else if (e.key === "ArrowUp" && n > 0) {
      e.preventDefault();
      setAberto(true);
      setAtivo((a) => (a <= 0 ? n - 1 : a - 1));
    } else if (e.key === "Escape" && aberto) {
      // Sem isto o campo de busca também apagaria o texto.
      e.preventDefault();
      setAberto(false);
      setAtivo(-1);
    } else if (e.key === "Enter" && aberto && ativo >= 0 && sugestoes[ativo]) {
      e.preventDefault();
      ir(sugestoes[ativo]);
    }
  };

  const mostrar = aberto && sugestoes.length > 0;

  return (
    <form action="/" method="get" role="search" className="escolha-busca">
      <div className="campo busca-campo">
        <label htmlFor={`${id}-busca`}>Nome da arena ou endereço</label>
        <input
          id={`${id}-busca`}
          name="busca"
          type="search"
          value={termo}
          maxLength={80}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={idLista}
          aria-expanded={mostrar}
          aria-activedescendant={mostrar && ativo >= 0 ? idOpcao(ativo) : undefined}
          onChange={(e) => {
            digitou.current = true;
            setTermo(e.target.value);
          }}
          onKeyDown={teclas}
          onFocus={() => {
            if (fechar.current) clearTimeout(fechar.current);
            if (sugestoes.length > 0 && termo.trim().length >= MINIMO) setAberto(true);
          }}
          onBlur={() => {
            // Pequena espera para o toque numa sugestão chegar antes de a lista sumir.
            fechar.current = setTimeout(() => {
              setAberto(false);
              setAtivo(-1);
            }, 150);
          }}
        />
        <ul id={idLista} role="listbox" aria-label="Sugestões" className="busca-sugestoes" hidden={!mostrar}>
          {sugestoes.map((s, i) => (
            <li
              key={s.slug}
              id={idOpcao(i)}
              role="option"
              aria-selected={i === ativo}
              className={i === ativo ? "busca-sugestao ativa" : "busca-sugestao"}
              // Mantém o foco no campo: o blur não fecha a lista antes do clique.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ir(s)}
            >
              <span className="busca-sugestao-nome">{s.nome}</span>
              {s.cidade && <span className="busca-sugestao-cidade">{s.cidade}</span>}
            </li>
          ))}
        </ul>
        <p className="so-leitor" aria-live="polite">
          {mostrar ? `${sugestoes.length} ${sugestoes.length === 1 ? "sugestão" : "sugestões"}` : ""}
        </p>
      </div>
      <button type="submit" className="botao">
        Buscar
      </button>
    </form>
  );
}

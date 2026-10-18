"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Avatar } from "@/app/componentes/avatar";
import { paginarEscolha, POR_PAGINA_ESCOLHA, textoSelecionados } from "./escolha-alunos-filtro";

// Escolha de alunos por caixas de marcar, usada na reserva nova, em "Editar
// alunos" da reserva e em "Atribuir a alunos" do lance. Tudo funciona sem
// JavaScript: os ids vão no campo repetido "alunoIds" e a lista aparece inteira.
//
// Com JavaScript e mais de 10 alunos, entram a busca, as páginas de 10 e a
// contagem de selecionados. Todas as caixas continuam no formulário: as que
// estão fora da página ou da busca só ficam escondidas (hidden), então o envio
// leva exatamente o que está marcado, em qualquer página.

export type AlunoEscolha = { id: string; nome: string };

export function CaixasAlunos({
  alunos,
  marcados,
  prefixo,
  legenda = "Alunos",
}: {
  alunos: AlunoEscolha[];
  marcados: string[];
  prefixo: string;
  legenda?: string;
}) {
  const caixa = useRef<HTMLFieldSetElement>(null);
  const [montado, setMontado] = useState(false);
  const [selecionados, setSelecionados] = useState(() => new Set(marcados));
  // Os marcados vão para o topo quando a lista abre e a cada busca; ao trocar
  // de página a ordem fica parada, para nenhum aluno pular de página no meio.
  const [fixados, setFixados] = useState(() => new Set(marcados));
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(1);

  const melhorada = montado && alunos.length > POR_PAGINA_ESCOLHA;
  const r = paginarEscolha(alunos, { fixados, termo, pagina });
  const porId = new Map(alunos.map((a) => [a.id, a]));

  // As caixas não são controladas: o estado é lido delas, que é o que o
  // formulário envia.
  function lerMarcadas(): Set<string> {
    const ids = new Set<string>();
    caixa.current
      ?.querySelectorAll<HTMLInputElement>('input[name="alunoIds"]')
      .forEach((c) => c.checked && ids.add(c.value));
    return ids;
  }

  useEffect(() => {
    setMontado(true);
    const atual = lerMarcadas();
    setSelecionados(atual);
    setFixados(atual);
    // Depois de salvar, o React reinicia o formulário (as caixas voltam ao
    // valor do banco); o evento reset chega antes disso, daí o setTimeout.
    const form = caixa.current?.form;
    if (!form) return;
    const aoReiniciar = () =>
      setTimeout(() => {
        const s = lerMarcadas();
        setSelecionados(s);
        setFixados(s);
        setTermo("");
        setPagina(1);
      }, 0);
    form.addEventListener("reset", aoReiniciar);
    return () => form.removeEventListener("reset", aoReiniciar);
  }, []);

  function buscar(valor: string) {
    setTermo(valor);
    setPagina(1);
    setFixados(lerMarcadas());
  }

  return (
    <fieldset
      ref={caixa}
      className="caixas-alunos"
      onChange={(e) => {
        if (e.target instanceof HTMLInputElement && e.target.name === "alunoIds") setSelecionados(lerMarcadas());
      }}
    >
      <legend>{legenda}</legend>
      {melhorada && (
        <div className="escolha-filtro">
          <div className="campo">
            <label htmlFor={`${prefixo}-busca`}>Buscar aluno</label>
            {/* Sem name: o termo não vai no envio. Enter não envia o formulário. */}
            <input
              id={`${prefixo}-busca`}
              type="search"
              value={termo}
              maxLength={80}
              autoComplete="off"
              aria-controls={`${prefixo}-lista`}
              onChange={(e) => buscar(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
            />
          </div>
          <p className="escolha-contagem" aria-live="polite">
            {textoSelecionados(selecionados.size)}
          </p>
        </div>
      )}
      <ul id={`${prefixo}-lista`}>
        {r.ordem.map((id) => {
          const a = porId.get(id)!;
          return (
            <li key={a.id} hidden={melhorada && !r.visiveis.has(a.id)}>
              {/* O rótulo envolve a caixa: a linha inteira é o alvo de toque. */}
              <label htmlFor={`${prefixo}-${a.id}`}>
                <input
                  id={`${prefixo}-${a.id}`}
                  type="checkbox"
                  name="alunoIds"
                  value={a.id}
                  defaultChecked={marcados.includes(a.id)}
                />
                <Avatar id={a.id} nome={a.nome} />
                <span>{a.nome}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {melhorada && (
        <>
          {r.encontrados === 0 && <p className="painel-vazio">Nenhum aluno encontrado.</p>}
          {r.paginas > 1 && (
            <div className="paginacao">
              <BotaoPagina rotulo="Anterior" ativo={r.pagina > 1} irPara={() => setPagina(r.pagina - 1)} />
              <span className="paginacao-texto" aria-live="polite">
                Página {r.pagina} de {r.paginas}
              </span>
              <BotaoPagina rotulo="Próxima" ativo={r.pagina < r.paginas} irPara={() => setPagina(r.pagina + 1)} />
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}

// aria-disabled em vez de disabled: o botão da ponta continua com o foco
// (quem chega à última página não perde o lugar) e só não faz nada.
function BotaoPagina({ rotulo, ativo, irPara }: { rotulo: string; ativo: boolean; irPara: () => void }) {
  return (
    <button
      type="button"
      className="botao paginacao-botao"
      aria-disabled={!ativo}
      onClick={() => {
        if (ativo) irPara();
      }}
    >
      {rotulo}
    </button>
  );
}

export type EstadoAlunos = { erro: string | null; ok: boolean };

// Formulário recolhido: o <summary> abre a lista, o botão salva. Depois de
// salvar, o React reinicia o formulário e as caixas voltam a refletir o banco
// (a página é revalidada pela action).
export function EditarAlunos({
  acao: acaoServidor,
  campo,
  valor,
  alunos,
  marcados,
  rotulo,
  legenda,
  salvar,
  salvo,
}: {
  acao: (estado: EstadoAlunos, form: FormData) => Promise<EstadoAlunos>;
  campo: string;
  valor: string;
  alunos: AlunoEscolha[];
  marcados: string[];
  rotulo: string;
  legenda: string;
  salvar: string;
  salvo: string;
}) {
  const [estado, acao, pendente] = useActionState(acaoServidor, { erro: null, ok: false });
  return (
    <div className="confirmar">
      <details>
        <summary className="botao">{rotulo}</summary>
        <form action={acao} className="confirmar-caixa">
          <input type="hidden" name={campo} value={valor} />
          <CaixasAlunos alunos={alunos} marcados={marcados} prefixo={`${campo}-${valor}`} legenda={legenda} />
          <button type="submit" className="botao botao-cheio" disabled={pendente}>
            {pendente ? "Salvando…" : salvar}
          </button>
        </form>
      </details>
      <p className="erro-form" role="alert">
        {estado.erro}
      </p>
      <p className="ok-form" role="status">
        {estado.ok ? salvo : ""}
      </p>
    </div>
  );
}

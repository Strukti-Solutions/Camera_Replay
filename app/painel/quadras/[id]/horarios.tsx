"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  chocam, DURACOES_FIXOS, gerarFixos, minutosDeTexto, primeiroChoque, separarChoques, textoIntervalo,
  textoMinutos, validarHorario, type HorarioComId,
} from "@/app/lib/horarios";
import { NOMES_DIAS, textoDeCentavos } from "@/app/lib/precos";
import {
  apagarHorarioAction, copiarDiaAction, criarFixosAction, criarHorarioAction, editarHorarioAction,
  type EstadoHorario,
} from "./actions";
import {
  avisoReservas, contagemPorDia, precoParaCampo, rotuloDuracao, valorHora,
} from "./horarios-apresentacao";

// Segunda primeiro, domingo por último: a semana de quadra começa na segunda.
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];
const ABREVIADOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const LONGOS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const minusculo = (d: number) => NOMES_DIAS[d].toLowerCase();

const INICIAL: EstadoHorario = { erro: null, mensagem: null, versao: 0 };

type Painel = { tipo: "novo" } | { tipo: "editar"; id: string } | { tipo: "copiar" };
type Rascunho = { inicio: string; fim: string; preco: string };

// useActionState + aviso de conclusão: cada resposta traz uma `versao` nova;
// sem erro, o pai recebe a mensagem de sucesso (fecha o painel, mostra o texto).
function useAcao(
  acao: (estado: EstadoHorario, form: FormData) => Promise<EstadoHorario>,
  aoConcluir: (mensagem: string) => void,
) {
  const [estado, formAction, pendente] = useActionState(acao, INICIAL);
  const ultimo = useRef(aoConcluir);
  useEffect(() => {
    ultimo.current = aoConcluir;
  });
  useEffect(() => {
    if (estado.versao > 0 && !estado.erro) ultimo.current(estado.mensagem ?? "");
  }, [estado]);
  return [estado, formAction, pendente] as const;
}

// Início/fim digitados: erro de forma, choque com outro horário do dia, ou nada.
function analisar(dia: number, inicioT: string, fimT: string, horarios: HorarioComId[], ignorarId?: string) {
  const inicio = minutosDeTexto(inicioT);
  const fim = minutosDeTexto(fimT, true);
  if (inicio === null || fim === null) return { valido: false, erro: null, choque: null };
  const h = { diaSemana: dia, inicio, fim, precoCentavos: 100 };
  const erro = validarHorario(h);
  if (erro) return { valido: false, erro, choque: null };
  const choque = primeiroChoque(h, horarios, ignorarId);
  return { valido: !choque, erro: null, choque };
}

function MensagemChoque({ choque, erro }: { choque: HorarioComId | null; erro: string | null }) {
  return (
    <p className="hr-aviso" role="alert">
      {choque ? (
        <>Esse horário choca com <b>{textoIntervalo(choque)}</b>. Mude o início ou o fim.</>
      ) : (
        erro
      )}
    </p>
  );
}

// ---------- Painel lateral ----------

function PainelLateral({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const idTitulo = useId();

  // Foco entra no painel ao abrir.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Esc fecha; Tab fica dentro do painel.
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        aoFechar();
      } else if (e.key === "Tab" && ref.current) {
        const itens = Array.from(
          ref.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (itens.length === 0) return;
        const primeiro = itens[0], ultimo = itens[itens.length - 1];
        const ativo = document.activeElement;
        if (e.shiftKey && (ativo === primeiro || ativo === ref.current)) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && ativo === ultimo) {
          e.preventDefault();
          primeiro.focus();
        }
      }
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [aoFechar]);

  return (
    <div className="hr-sombra" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div ref={ref} className="hr-painel" role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
        <div className="hr-painel-cabeca">
          <h3 id={idTitulo}>{titulo}</h3>
          <button type="button" className="botao hr-fechar" aria-label="Fechar painel" onClick={aoFechar}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Apagar (caixinha e painel) ----------

function ConfirmaApagar({
  horario, reservas, aoCancelar, aoConcluir,
}: { horario: HorarioComId; reservas: number; aoCancelar: () => void; aoConcluir: (m: string) => void }) {
  const [estado, acao, pendente] = useAcao(apagarHorarioAction, aoConcluir);
  const aviso = avisoReservas(reservas);
  return (
    <form action={acao} className="hr-confirma">
      <input type="hidden" name="horarioId" value={horario.id} />
      <p>
        Apagar <b>{textoIntervalo(horario)}</b>?{aviso ? ` ${aviso}` : ""}
      </p>
      <div className="hr-linha-botoes">
        <button type="submit" className="botao botao-perigo-cheio" disabled={pendente}>
          {pendente ? "Apagando…" : "Confirmar: apagar"}
        </button>
        <button type="button" className="botao" onClick={aoCancelar} autoFocus>
          Cancelar
        </button>
      </div>
      <p className="erro-form" role="alert">{estado.erro}</p>
    </form>
  );
}

// ---------- Campos de um horário ----------

function CamposHorario({
  prefixo, v, aoMudar, invalido,
}: {
  prefixo: string; v: Rascunho; invalido: boolean;
  aoMudar: (campo: keyof Rascunho, valor: string) => void;
}) {
  return (
    <div className="hr-linha3">
      <div className="campo">
        <label htmlFor={`${prefixo}-inicio`}>Início</label>
        <input id={`${prefixo}-inicio`} name="inicio" type="time" required value={v.inicio}
          aria-invalid={invalido || undefined} onChange={(e) => aoMudar("inicio", e.target.value)} />
      </div>
      <div className="campo">
        <label htmlFor={`${prefixo}-fim`}>Fim</label>
        <input id={`${prefixo}-fim`} name="fim" type="time" required value={v.fim}
          aria-invalid={invalido || undefined} onChange={(e) => aoMudar("fim", e.target.value)} />
      </div>
      <div className="campo">
        <label htmlFor={`${prefixo}-preco`}>Preço (R$)</label>
        <input id={`${prefixo}-preco`} name="preco" type="text" inputMode="decimal" maxLength={15} required
          placeholder="80,00" value={v.preco} onChange={(e) => aoMudar("preco", e.target.value)} />
      </div>
    </div>
  );
}

// ---------- Editar ----------

function EditarHorario({
  horario, horarios, reservas, aoConflito, aoConcluir,
}: {
  horario: HorarioComId; horarios: HorarioComId[]; reservas: number;
  aoConflito: (id: string | null) => void; aoConcluir: (m: string) => void;
}) {
  const [v, setV] = useState<Rascunho>({
    inicio: valorHora(horario.inicio), fim: valorHora(horario.fim), preco: precoParaCampo(horario.precoCentavos),
  });
  const [apagando, setApagando] = useState(false);
  const [estado, acao, pendente] = useAcao(editarHorarioAction, aoConcluir);
  const a = analisar(horario.diaSemana, v.inicio, v.fim, horarios, horario.id);
  const choqueId = a.choque?.id ?? null;
  useEffect(() => {
    aoConflito(choqueId);
    return () => aoConflito(null);
  }, [choqueId, aoConflito]);
  const aviso = avisoReservas(reservas);
  return (
    <>
      <form action={acao} className="hr-form">
        <input type="hidden" name="horarioId" value={horario.id} />
        <CamposHorario prefixo="ed" v={v} invalido={!a.valido && (a.choque !== null || a.erro !== null)}
          aoMudar={(c, valor) => setV((x) => ({ ...x, [c]: valor }))} />
        <MensagemChoque choque={a.choque} erro={a.erro} />
        {aviso && <p className="hr-aviso hr-aviso-info">{aviso}</p>}
        <p className="erro-form" role="alert">{estado.erro}</p>
        <div className="hr-linha-botoes">
          <button type="submit" className="botao botao-cheio" disabled={pendente || !a.valido}>
            {pendente ? "Salvando…" : "Salvar"}
          </button>
          <button type="button" className="botao botao-perigo" onClick={() => setApagando(true)}>
            Apagar
          </button>
        </div>
      </form>
      {apagando && (
        <ConfirmaApagar horario={horario} reservas={reservas} aoCancelar={() => setApagando(false)}
          aoConcluir={aoConcluir} />
      )}
    </>
  );
}

// ---------- Novo: um horário ou vários fixos ----------

function UmHorario({
  quadraId, dia, horarios, v, setV, aoConcluir,
}: {
  quadraId: string; dia: number; horarios: HorarioComId[]; v: Rascunho;
  setV: (f: (x: Rascunho) => Rascunho) => void; aoConcluir: (m: string) => void;
}) {
  const [estado, acao, pendente] = useAcao(criarHorarioAction, aoConcluir);
  const a = analisar(dia, v.inicio, v.fim, horarios);
  return (
    <form action={acao} className="hr-form">
      <input type="hidden" name="quadraId" value={quadraId} />
      <input type="hidden" name="dia" value={dia} />
      <CamposHorario prefixo="um" v={v} invalido={!a.valido && (a.choque !== null || a.erro !== null)}
        aoMudar={(c, valor) => setV((x) => ({ ...x, [c]: valor }))} />
      <MensagemChoque choque={a.choque} erro={a.erro} />
      <p className="erro-form" role="alert">{estado.erro}</p>
      <div className="hr-linha-botoes">
        <button type="submit" className="botao botao-cheio" disabled={pendente || !a.valido}>
          {pendente ? "Adicionando…" : "Adicionar"}
        </button>
      </div>
    </form>
  );
}

type Fixos = { das: string; ate: string; duracao: number; preco: string };

function VariosFixos({
  quadraId, dia, horarios, v, setV, aoConcluir,
}: {
  quadraId: string; dia: number; horarios: HorarioComId[]; v: Fixos;
  setV: (f: (x: Fixos) => Fixos) => void; aoConcluir: (m: string) => void;
}) {
  const [estado, acao, pendente] = useAcao(criarFixosAction, aoConcluir);
  const das = minutosDeTexto(v.das);
  const ate = minutosDeTexto(v.ate, true);
  const lista = das !== null && ate !== null
    ? gerarFixos({ diaSemana: dia, das, ate, duracao: v.duracao, precoCentavos: 100 })
    : [];
  const doDia = horarios.filter((h) => h.diaSemana === dia);
  const { criar, pulados } = separarChoques(lista, doDia);
  const n = criar.length, p = pulados.length;
  return (
    <form action={acao} className="hr-form">
      <input type="hidden" name="quadraId" value={quadraId} />
      <input type="hidden" name="dia" value={dia} />
      <div className="hr-linha2">
        <div className="campo">
          <label htmlFor="fx-das">Das</label>
          <input id="fx-das" name="das" type="time" required value={v.das}
            onChange={(e) => setV((x) => ({ ...x, das: e.target.value }))} />
        </div>
        <div className="campo">
          <label htmlFor="fx-ate">Até</label>
          <input id="fx-ate" name="ate" type="time" required value={v.ate}
            onChange={(e) => setV((x) => ({ ...x, ate: e.target.value }))} />
        </div>
        <div className="campo">
          <label htmlFor="fx-duracao">Cada um dura</label>
          <select id="fx-duracao" name="duracao" value={v.duracao}
            onChange={(e) => setV((x) => ({ ...x, duracao: Number(e.target.value) }))}>
            {DURACOES_FIXOS.map((d) => <option key={d} value={d}>{rotuloDuracao(d)}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="fx-preco">Preço (R$)</label>
          <input id="fx-preco" name="preco" type="text" inputMode="decimal" maxLength={15} required placeholder="80,00"
            value={v.preco} onChange={(e) => setV((x) => ({ ...x, preco: e.target.value }))} />
        </div>
      </div>
      {lista.length > 0 ? (
        <ul className="hr-previa" aria-label="Prévia dos horários">
          {lista.map((h) => {
            const choca = doDia.some((e) => chocam(h, e));
            return (
              <li key={h.inicio} className={choca ? "hr-chip hr-chip-choca" : "hr-chip"}>
                {textoMinutos(h.inicio)}–{textoMinutos(h.fim)}
                {choca && <span className="so-leitor"> (choca)</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="suave" role="status">Escolha horas em que caiba pelo menos um horário.</p>
      )}
      {p > 0 && (
        <p className="hr-aviso" role="alert">
          {p === 1
            ? "1 horário choca com os que já existem e será pulado."
            : `${p} horários chocam com os que já existem e serão pulados.`}
        </p>
      )}
      <p className="erro-form" role="alert">{estado.erro}</p>
      <div className="hr-linha-botoes">
        <button type="submit" className="botao botao-cheio" disabled={pendente || n === 0}>
          {pendente ? "Criando…" : n === 0 ? "Criar horários" : `Criar ${n} ${n === 1 ? "horário" : "horários"}`}
        </button>
      </div>
    </form>
  );
}

function NovoHorario({
  quadraId, dia, horarios, aoConflito, aoConcluir,
}: {
  quadraId: string; dia: number; horarios: HorarioComId[];
  aoConflito: (id: string | null) => void; aoConcluir: (m: string) => void;
}) {
  const [aba, setAba] = useState<"um" | "fixos">("um");
  const [um, setUm] = useState<Rascunho>({ inicio: "", fim: "", preco: "" });
  const [fixos, setFixos] = useState<Fixos>({ das: "07:00", ate: "22:00", duracao: 60, preco: "" });
  const choqueId = aba === "um" ? (analisar(dia, um.inicio, um.fim, horarios).choque?.id ?? null) : null;
  useEffect(() => {
    aoConflito(choqueId);
    return () => aoConflito(null);
  }, [choqueId, aoConflito]);

  const abas = [["um", "Um horário"], ["fixos", "Vários fixos"]] as const;
  return (
    <>
      <div className="hr-abas" role="tablist" aria-label="Como criar"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const novo = aba === "um" ? "fixos" : "um";
            setAba(novo);
            document.getElementById(`aba-${novo}`)?.focus();
          }
        }}>
        {abas.map(([id, rotulo]) => (
          <button key={id} id={`aba-${id}`} type="button" role="tab" aria-selected={aba === id}
            aria-controls={`painel-${id}`} tabIndex={aba === id ? 0 : -1} className="hr-aba"
            onClick={() => setAba(id)}>
            {rotulo}
          </button>
        ))}
      </div>
      <div id={`painel-${aba}`} role="tabpanel" aria-labelledby={`aba-${aba}`}>
        {aba === "um" ? (
          <UmHorario quadraId={quadraId} dia={dia} horarios={horarios} v={um} setV={setUm} aoConcluir={aoConcluir} />
        ) : (
          <VariosFixos quadraId={quadraId} dia={dia} horarios={horarios} v={fixos} setV={setFixos}
            aoConcluir={aoConcluir} />
        )}
      </div>
    </>
  );
}

// ---------- Copiar o dia ----------

function CopiarDia({ quadraId, dia, aoConcluir }: { quadraId: string; dia: number; aoConcluir: (m: string) => void }) {
  const [estado, acao, pendente] = useAcao(copiarDiaAction, aoConcluir);
  // Controlados: o React 19 limpa o formulário após a ação, e o erro não pode perder a escolha.
  const [marcados, setMarcados] = useState<number[]>([]);
  return (
    <form action={acao} className="hr-form">
      <input type="hidden" name="quadraId" value={quadraId} />
      <input type="hidden" name="dia" value={dia} />
      <fieldset className="dias">
        <legend>Copiar para</legend>
        {ORDEM_DIAS.filter((d) => d !== dia).map((d) => (
          <label key={d} className="dia">
            <input type="checkbox" name="destino" value={d} checked={marcados.includes(d)}
              onChange={(e) => setMarcados((m) => (e.target.checked ? [...m, d] : m.filter((x) => x !== d)))} />
            {NOMES_DIAS[d]}
          </label>
        ))}
      </fieldset>
      <p className="suave">Horários que chocam com os do dia de destino são pulados.</p>
      <p className="erro-form" role="alert">{estado.erro}</p>
      <div className="hr-linha-botoes">
        <button type="submit" className="botao botao-cheio" disabled={pendente}>
          {pendente ? "Copiando…" : "Copiar"}
        </button>
      </div>
    </form>
  );
}

// ---------- Tela ----------

export function HorariosDaQuadra({
  quadraId, horarios, reservasFuturas, diaInicial,
}: {
  quadraId: string; horarios: HorarioComId[]; reservasFuturas: Record<string, number>; diaInicial: number;
}) {
  const [dia, setDia] = useState(diaInicial);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [apagando, setApagando] = useState<string | null>(null);
  const [conflito, setConflito] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState("");
  const abridor = useRef<HTMLElement | null>(null);
  const botaoNovo = useRef<HTMLButtonElement>(null);

  const contagem = contagemPorDia(horarios);
  const doDia = horarios.filter((h) => h.diaSemana === dia);
  const editado = painel?.tipo === "editar" ? horarios.find((h) => h.id === painel.id) : undefined;
  const aberto = painel !== null && (painel.tipo !== "editar" || editado !== undefined);

  // Ao fechar, o foco volta a quem abriu (ou ao "+ Novo horário" se ele sumiu).
  const estavaAberto = useRef(false);
  useEffect(() => {
    if (estavaAberto.current && !aberto) {
      const el = abridor.current;
      (el && el.isConnected ? el : botaoNovo.current)?.focus();
    }
    estavaAberto.current = aberto;
  }, [aberto]);

  const abrir = (p: Painel, el: HTMLElement) => {
    abridor.current = el;
    setApagando(null);
    setMensagem("");
    setPainel(p);
  };
  const fechar = () => {
    setPainel(null);
    setConflito(null);
  };
  const concluir = (m: string) => {
    // Apagou pela caixinha: a caixinha some e o foco iria para o body.
    if (apagando) requestAnimationFrame(() => botaoNovo.current?.focus());
    setMensagem(m);
    setApagando(null);
    fechar();
  };
  const cancelarApagar = (id: string) => {
    setApagando(null);
    requestAnimationFrame(() => document.getElementById(`hr-x-${id}`)?.focus());
  };

  return (
    <div className="horarios">
      <div className="hr-dias" role="group" aria-label="Dia da semana">
        {ORDEM_DIAS.map((d) => {
          const n = contagem[d];
          return (
            <button key={d} type="button" className="hr-dia" aria-pressed={d === dia}
              aria-label={`${NOMES_DIAS[d]}, ${n === 0 ? "sem horários" : n === 1 ? "1 horário" : `${n} horários`}`}
              onClick={() => { setDia(d); setApagando(null); setMensagem(""); }}>
              <span>{ABREVIADOS[d]}</span>
              <small aria-hidden="true">{n === 0 ? "—" : n}</small>
            </button>
          );
        })}
      </div>

      <h3 className="hr-titulo-dia">{LONGOS[dia]}</h3>
      {horarios.length === 0 && (
        <p className="suave">Sem horários: esta quadra ainda não aceita reservas.</p>
      )}
      {horarios.length > 0 && doDia.length === 0 && <p className="suave">Sem horários neste dia.</p>}

      <ul className="hr-slots">
        {doDia.map((h) => {
          const nome = textoIntervalo(h);
          return (
            <li key={h.id} className={`hr-slot${conflito === h.id ? " hr-slot-conflito" : ""}${apagando === h.id ? " hr-slot-largo" : ""}`}>
              <button type="button" className="hr-slot-corpo"
                aria-label={`Editar ${nome}, ${textoDeCentavos(h.precoCentavos)}`}
                onClick={(e) => abrir({ tipo: "editar", id: h.id }, e.currentTarget)}>
                <strong>{nome}</strong>
                <span>{textoDeCentavos(h.precoCentavos)}</span>
              </button>
              <button type="button" id={`hr-x-${h.id}`} className="hr-slot-x" aria-label={`Apagar ${nome}`}
                onClick={() => { setMensagem(""); setApagando(h.id); }}>
                ✕
              </button>
              {apagando === h.id && (
                <ConfirmaApagar horario={h} reservas={reservasFuturas[h.id] ?? 0}
                  aoCancelar={() => cancelarApagar(h.id)} aoConcluir={concluir} />
              )}
            </li>
          );
        })}
        <li className="hr-slot-lista-novo">
          <button ref={botaoNovo} type="button" className="hr-slot hr-slot-novo"
            onClick={(e) => abrir({ tipo: "novo" }, e.currentTarget)}>
            + Novo horário
          </button>
        </li>
      </ul>

      <p className="ok-form" role="status">{mensagem}</p>

      {doDia.length > 0 && (
        <div>
          <button type="button" className="botao" onClick={(e) => abrir({ tipo: "copiar" }, e.currentTarget)}>
            Copiar {minusculo(dia)} para outros dias…
          </button>
        </div>
      )}

      {aberto && painel?.tipo === "novo" && (
        <PainelLateral titulo={`Novo horário · ${minusculo(dia)}`} aoFechar={fechar}>
          <NovoHorario quadraId={quadraId} dia={dia} horarios={horarios} aoConflito={setConflito} aoConcluir={concluir} />
        </PainelLateral>
      )}
      {aberto && painel?.tipo === "editar" && editado && (
        <PainelLateral titulo={`Horário · ${minusculo(editado.diaSemana)} ${textoIntervalo(editado)}`} aoFechar={fechar}>
          <EditarHorario key={editado.id} horario={editado} horarios={horarios}
            reservas={reservasFuturas[editado.id] ?? 0} aoConflito={setConflito} aoConcluir={concluir} />
        </PainelLateral>
      )}
      {aberto && painel?.tipo === "copiar" && (
        <PainelLateral titulo={`Copiar ${minusculo(dia)} para outros dias`} aoFechar={fechar}>
          <CopiarDia quadraId={quadraId} dia={dia} aoConcluir={concluir} />
        </PainelLateral>
      )}
    </div>
  );
}

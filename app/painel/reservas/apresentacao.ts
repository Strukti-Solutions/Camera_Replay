import { diaDaSemana, diasDisponiveis, hojeLocal, horariosDoDia, minutoDoFim, partesDoInstante } from "@/app/lib/disponibilidade";
import { textoMinutos, type HorarioComId } from "@/app/lib/horarios";
import { textoDeCentavos } from "@/app/lib/precos";
import type { ItemAgenda } from "@/app/lib/reservas";

// Textos e cortes da agenda do dono, sem cookie nem banco para testar direto.
// Fica fora do actions.ts: arquivo "use server" só exporta funções async.

export const DIAS_AGENDA = 14;
export const DIAS_HISTORICO = 30;

export const MSG_MOTIVO_LONGO = "O motivo pode ter até 120 caracteres.";
export const MSG_DONO_NAO_CANCELOU = "Não foi possível cancelar. A reserva já começou ou não existe mais.";
export const MSG_BLOQUEIO_NAO_REMOVIDO = "Não foi possível remover. O bloqueio já começou ou não existe mais.";
export const MSG_TENTE_DE_NOVO = "Não foi possível concluir agora. Tente de novo em instantes.";

// Mensagens fixas por valor exato de ?ok=; o que vier na URL nunca é exibido.
export function mensagemOkAgenda(valor: string | string[] | undefined): string | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  if (v === "cancelada") return "Reserva cancelada.";
  if (v === "bloqueado") return "Horário bloqueado.";
  if (v === "removido" || v === "desbloqueado") return "Bloqueio removido.";
  return null;
}

// Só id de quadra da arena da sessão vale como filtro.
export function quadraDoFiltro(valor: string | string[] | undefined, quadras: { id: string }[]): string | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return typeof v === "string" && quadras.some((q) => q.id === v) ? v : null;
}

function somaDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

// Dias da agenda (hoje + 13) e o intervalo consultado, que inclui o histórico.
export function intervaloAgenda(agora: Date): { de: string; ate: string; dias: string[] } {
  const dias = diasDisponiveis(agora).slice(0, DIAS_AGENDA).map((d) => d.valor);
  return { de: somaDias(hojeLocal(agora), -DIAS_HISTORICO), ate: dias[dias.length - 1], dias };
}

// Próximas: tudo que ainda não terminou, em ordem (canceladas ficam no dia, sem
// botão). Histórico: só as passadas, mais recentes primeiro.
export function dividirAgenda(itens: ItemAgenda[], agora: Date): { proximas: ItemAgenda[]; historico: ItemAgenda[] } {
  const proxima = (i: ItemAgenda) => i.fim.getTime() > agora.getTime();
  return {
    proximas: itens.filter(proxima),
    historico: itens.filter((i) => !proxima(i)).sort((a, b) => b.inicio.getTime() - a.inicio.getTime()),
  };
}

// Botões Cancelar/Remover: só em item confirmado que ainda não começou.
export function podeAgir(i: ItemAgenda): boolean {
  return i.futura && i.situacao === "confirmada";
}

// Agrupa pelo dia local do início; o que começou antes do primeiro dia (jogo de
// ontem 23h–1h ainda em andamento) entra no primeiro dia.
export function porDia(dias: string[], itens: ItemAgenda[]): { dia: string; itens: ItemAgenda[] }[] {
  const diaDo = (i: ItemAgenda) => {
    const d = hojeLocal(i.inicio);
    return d < dias[0] ? dias[0] : d;
  };
  return dias.map((dia) => ({ dia, itens: itens.filter((i) => diaDo(i) === dia) }));
}

export function rotuloQuadra(nome: string, esporte: string): string {
  return esporte ? `${nome} — ${esporte}` : nome;
}

function situacaoDono(i: ItemAgenda): string {
  if (i.situacao !== "cancelada") return "Confirmada";
  const quem = i.canceladaPor === "jogador" ? "Cancelada pelo jogador" : "Cancelada pela arena";
  return i.motivoCancelamento ? `${quem} · ${i.motivoCancelamento}` : quem;
}

// "16h–18h · Quadra 1 — Padel · Ana · R$ 200,00 · Confirmada" ou
// "16h–18h · Quadra 1 — Padel · Bloqueado · Aula" (horas cheias saem sem minutos; meia-noite no fim = 24h).
export function linhaItem(i: ItemAgenda): string {
  const horario = `${textoMinutos(partesDoInstante(i.inicio).minuto)}–${textoMinutos(minutoDoFim(i.fim))}`;
  const quadra = rotuloQuadra(i.quadra, i.esporte);
  if (i.tipo === "bloqueio") {
    const partes = [horario, quadra, "Bloqueado", i.motivo ?? ""];
    if (i.situacao === "cancelada") partes.push("Removido");
    return partes.join(" · ");
  }
  return [horario, quadra, i.jogador ?? "Conta apagada", textoDeCentavos(i.totalCentavos ?? 0), situacaoDono(i)].join(" · ");
}

// ---------- Calendário do dono (fase 6) ----------

export const CAIXINHAS_POR_PAGINA = 12;
const MESES_PARA_TRAS = 3;
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const primeiroDe = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const ultimoDoMes = (mes: string) => somaDias(somaDias(`${mes}-01`, 32).slice(0, 7) + "-01", -1);

// Faixa do calendário do dono: do 1º dia de 3 meses atrás até o fim da janela de reserva.
function faixaDoDono(agora: Date): { de: string; ate: string } {
  const [a, m] = hojeLocal(agora).split("-").map(Number);
  const de = new Date(Date.UTC(a, m - 1 - MESES_PARA_TRAS, 1)).toISOString().slice(0, 10);
  const janela = diasDisponiveis(agora);
  return { de, ate: janela[janela.length - 1].valor };
}

// Dia da URL dentro da faixa (e que existe no calendário); o resto vira hoje.
export function lerDiaDono(v: string | string[] | undefined, agora: Date): string {
  const d = primeiroDe(v);
  const { de, ate } = faixaDoDono(agora);
  if (typeof d === "string" && DIA_ISO.test(d) && somaDias(d, 0) === d && d >= de && d <= ate) return d;
  return hojeLocal(agora);
}

export function mesesDoDono(agora: Date): string[] {
  const { de, ate } = faixaDoDono(agora);
  const meses: string[] = [];
  for (let m = de.slice(0, 7); m <= ate.slice(0, 7); m = somaDias(`${m}-01`, 32).slice(0, 7)) meses.push(m);
  return meses;
}

export function lerMesDono(v: string | string[] | undefined, dia: string, agora: Date): string {
  const m = primeiroDe(v);
  return typeof m === "string" && mesesDoDono(agora).includes(m) ? m : dia.slice(0, 7);
}

export function lerPagina(v: string | string[] | undefined): number {
  const p = primeiroDe(v);
  return typeof p === "string" && /^[1-9]\d{0,2}$/.test(p) ? Number(p) : 1;
}

// Semana de domingo a sábado que contém o dia.
export function semanaDoDia(dia: string): string[] {
  const domingo = somaDias(dia, -diaDaSemana(dia));
  return Array.from({ length: 7 }, (_, i) => somaDias(domingo, i));
}

export type DiaDoDono = { dia: string; numero: number; doMes: boolean; n: number; escolhido: boolean; hoje: boolean; naFaixa: boolean };

// Semanas de domingo a sábado cobrindo o mês, com a contagem de reservas de cada dia.
export function calendarioDoDono(mes: string, porDia: Map<string, number>, escolhido: string, agora: Date): DiaDoDono[][] {
  const hoje = hojeLocal(agora);
  const { de, ate } = faixaDoDono(agora);
  const primeiro = `${mes}-01`;
  const ultimo = ultimoDoMes(mes);
  const semanas: DiaDoDono[][] = [];
  for (let d = somaDias(primeiro, -diaDaSemana(primeiro)); d <= ultimo || diaDaSemana(d) !== 0; d = somaDias(d, 1)) {
    if (diaDaSemana(d) === 0) semanas.push([]);
    semanas[semanas.length - 1].push({
      dia: d,
      numero: Number(d.slice(8)),
      doMes: d.slice(0, 7) === mes,
      n: porDia.get(d) ?? 0,
      escolhido: d === escolhido,
      hoje: d === hoje,
      naFaixa: d >= de && d <= ate,
    });
  }
  return semanas;
}

export type Caixinha =
  | { tipo: "reserva" | "bloqueio"; inicio: number; fim: number; item: ItemAgenda }
  | { tipo: "livre"; inicio: number; fim: number; precoCentavos: number };

export type GrupoDoDia = {
  quadraId: string;
  quadra: string;
  esporte: string;
  caixinhas: Caixinha[];
  livres: { inicio: number; fim: number }[]; // o que "Bloquear o dia todo" leva
};

const minutoDe = (d: Date) => partesDoInstante(d).minuto;
const pesoDoTipo = (c: Caixinha) => (c.tipo === "livre" ? 1 : 0);

// Caixinhas do dia por quadra: reservas e bloqueios (canceladas também, sem
// ação) e os horários criados que estão livres e ainda não começaram. Em ordem
// de início; no empate, a reserva vem antes do livre.
export function caixinhasDoDia(
  itens: ItemAgenda[],
  quadras: { id: string; nome: string; esporte: string; horarios: HorarioComId[] }[],
  dia: string,
  agora: Date,
): GrupoDoDia[] {
  return quadras.map((q) => {
    const doDia = itens.filter((i) => i.quadraId === q.id && hojeLocal(i.inicio) === dia);
    const ocupados = doDia.filter((i) => i.situacao === "confirmada").map((i) => ({ inicio: i.inicio, fim: i.fim }));
    const livres = horariosDoDia(q.horarios, dia, agora, ocupados).filter((x) => x.livre);
    const caixinhas: Caixinha[] = [
      ...doDia.map((i): Caixinha => ({ tipo: i.tipo, inicio: minutoDe(i.inicio), fim: minutoDoFim(i.fim), item: i })),
      ...livres.map((x): Caixinha => ({ tipo: "livre", inicio: x.horario.inicio, fim: x.horario.fim, precoCentavos: x.horario.precoCentavos })),
    ].sort((a, b) => a.inicio - b.inicio || pesoDoTipo(a) - pesoDoTipo(b));
    return {
      quadraId: q.id,
      quadra: q.nome,
      esporte: q.esporte,
      caixinhas,
      livres: livres.map((x) => ({ inicio: x.horario.inicio, fim: x.horario.fim })),
    };
  });
}

// Páginas de caixinhas atravessando as quadras. Sem nenhuma caixinha, os grupos
// voltam vazios (a tela diz "nada neste dia" em cada um).
export function paginarCaixinhas(
  grupos: GrupoDoDia[], pagina: number, porPagina = CAIXINHAS_POR_PAGINA,
): { grupos: GrupoDoDia[]; pagina: number; paginas: number } {
  const total = grupos.reduce((s, g) => s + g.caixinhas.length, 0);
  if (total === 0) return { grupos, pagina: 1, paginas: 1 };
  const paginas = Math.ceil(total / porPagina);
  const p = Math.min(Math.max(1, pagina), paginas);
  const de = (p - 1) * porPagina;
  const ate = de + porPagina;
  let pos = 0;
  const saida: GrupoDoDia[] = [];
  for (const g of grupos) {
    const ini = Math.max(de - pos, 0);
    const fim = Math.min(ate - pos, g.caixinhas.length);
    if (fim > ini) saida.push({ ...g, caixinhas: g.caixinhas.slice(ini, fim) });
    pos += g.caixinhas.length;
  }
  return { grupos: saida, pagina: p, paginas };
}

export function hrefAgenda(p: {
  quadra?: string | null; dia?: string; mes?: string; pagina?: number; busca?: string; ver?: "mes" | null;
}): string {
  const q = new URLSearchParams();
  if (p.quadra) q.set("quadra", p.quadra);
  if (p.dia) q.set("dia", p.dia);
  if (p.mes) q.set("mes", p.mes);
  if (p.busca) q.set("busca", p.busca);
  if (p.pagina && p.pagina > 1) q.set("pagina", String(p.pagina));
  if (p.ver) q.set("ver", p.ver);
  const s = q.toString();
  return s ? `/painel/reservas?${s}` : "/painel/reservas";
}

const VOLTA = /^\/painel\/reservas(\?[A-Za-z0-9=&%._*+-]*)?$/;

// Para onde a ação volta: só a própria agenda, com parâmetros simples (nada de
// outro site nem de outro caminho).
export function voltaSegura(v: unknown): string {
  return typeof v === "string" && VOLTA.test(v) ? v : "/painel/reservas";
}

// A volta com o aviso da ação, trocando os avisos que já estavam na URL.
export function comAviso(volta: string, aviso: Record<string, string>): string {
  const [caminho, busca = ""] = volta.split("?");
  const q = new URLSearchParams(busca);
  for (const k of ["ok", "bloqueados", "pulados"]) q.delete(k);
  for (const [k, v] of Object.entries(aviso)) q.set(k, v);
  return `${caminho}?${q.toString()}`;
}

const contagem = (v: string | string[] | undefined) => {
  const x = primeiroDe(v);
  return typeof x === "string" && /^\d{1,2}$/.test(x) ? Number(x) : null;
};

// Mensagem depois de bloquear (?bloqueados=N&pulados=M): montada só com os números.
export function mensagemDoBloqueio(b: string | string[] | undefined, p: string | string[] | undefined): string | null {
  const bloqueados = contagem(b);
  const pulados = contagem(p);
  if (bloqueados === null || pulados === null) return null;
  const primeira =
    bloqueados === 0 ? "Nenhum horário bloqueado." : bloqueados === 1 ? "1 horário bloqueado." : `${bloqueados} horários bloqueados.`;
  if (pulados === 0) return primeira;
  const segunda = pulados === 1 ? "1 pulado (já ocupado ou começado)." : `${pulados} pulados (já ocupados ou começados).`;
  return `${primeira} ${segunda}`;
}

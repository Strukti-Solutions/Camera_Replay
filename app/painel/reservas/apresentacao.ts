import { FUSO, diasDisponiveis, hojeLocal } from "@/app/lib/disponibilidade";
import { textoDeCentavos, textoHora } from "@/app/lib/precos";
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
  if (v === "removido") return "Bloqueio removido.";
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

const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" });
const horaLocal = (d: Date) => Number(HORA.format(d));

export function rotuloQuadra(nome: string, esporte: string): string {
  return esporte ? `${nome} — ${esporte}` : nome;
}

function situacaoDono(i: ItemAgenda): string {
  if (i.situacao !== "cancelada") return "Confirmada";
  const quem = i.canceladaPor === "jogador" ? "Cancelada pelo jogador" : "Cancelada pela arena";
  return i.motivoCancelamento ? `${quem} · ${i.motivoCancelamento}` : quem;
}

// "16h–18h · Quadra 1 — Padel · Ana · R$ 200,00 · Confirmada" ou
// "16h–18h · Quadra 1 — Padel · Bloqueado · Aula" (horas cheias; meia-noite no fim = 24h).
export function linhaItem(i: ItemAgenda): string {
  const horario = `${textoHora(horaLocal(i.inicio))}–${textoHora(horaLocal(i.fim) || 24)}`;
  const quadra = rotuloQuadra(i.quadra, i.esporte);
  if (i.tipo === "bloqueio") {
    const partes = [horario, quadra, "Bloqueado", i.motivo ?? ""];
    if (i.situacao === "cancelada") partes.push("Removido");
    return partes.join(" · ");
  }
  return [horario, quadra, i.jogador ?? "Conta apagada", textoDeCentavos(i.totalCentavos ?? 0), situacaoDono(i)].join(" · ");
}

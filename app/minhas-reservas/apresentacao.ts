import { FUSO, hojeLocal } from "@/app/lib/disponibilidade";
import { textoHora } from "@/app/lib/precos";
import { diaPorExtenso } from "@/app/a/[slug]/apresentacao";

// Textos de Minhas reservas, sem cookie nem banco para poder testar direto.

// O motivo só aparece quando foi a arena que cancelou (é o texto do dono).
export function rotuloSituacao(situacao: string, canceladaPor: string | null, motivo: string | null = null): string {
  if (situacao !== "cancelada") return "Confirmada";
  if (canceladaPor === "jogador") return "Cancelada por você";
  return canceladaPor === "dono" && motivo ? `Cancelada pela arena · ${motivo}` : "Cancelada pela arena";
}

// Mensagens fixas por valor exato de ?ok=; o que vier na URL nunca é exibido.
export function mensagemOk(valor: string | string[] | undefined): string | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  if (v === "reservada") return "Reserva confirmada.";
  if (v === "cancelada") return "Reserva cancelada.";
  return null;
}

const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" });
const horaLocal = (d: Date) => Number(HORA.format(d));

// "Segunda-feira, 26 de outubro · 16h às 18h" (reservas são de horas cheias).
export function textoPeriodo(inicio: Date, fim: Date): string {
  const fimH = horaLocal(fim) || 24;
  return `${diaPorExtenso(hojeLocal(inicio))} · ${textoHora(horaLocal(inicio))} às ${textoHora(fimH)}`;
}

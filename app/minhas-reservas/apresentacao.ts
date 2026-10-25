import { hojeLocal, partesDoInstante } from "@/app/lib/disponibilidade";
import { textoMinutos } from "@/app/lib/horarios";
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

// Fim à meia-noite conta como 24h (minuto 1440 do dia do início).
const fimEmMinutos = (d: Date) => partesDoInstante(d).minuto || 1440;

// "Segunda-feira, 26 de outubro · 15h30 às 17h15" (horas cheias saem como 16h).
export function textoPeriodo(inicio: Date, fim: Date): string {
  return `${diaPorExtenso(hojeLocal(inicio))} · ${textoMinutos(partesDoInstante(inicio).minuto)} às ${textoMinutos(fimEmMinutos(fim))}`;
}

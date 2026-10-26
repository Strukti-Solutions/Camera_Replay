import { hojeLocal, minutoDoFim, partesDoInstante } from "@/app/lib/disponibilidade";
import { textoMinutos } from "@/app/lib/horarios";
import { textoDeCentavos } from "@/app/lib/precos";
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
  if (v === "paga") return "Pagamento enviado. A reserva aparece como confirmada assim que o Asaas avisar, em instantes.";
  if (v === "sem-pagamento") return "Não foi possível abrir o pagamento. O horário foi liberado; tente reservar de novo.";
  return null;
}

// "Segunda-feira, 26 de outubro · 15h30 às 17h15" (horas cheias saem como 16h).
export function textoPeriodo(inicio: Date, fim: Date): string {
  return `${diaPorExtenso(hojeLocal(inicio))} · ${textoMinutos(partesDoInstante(inicio).minuto)} às ${textoMinutos(minutoDoFim(fim))}`;
}

type Parametro = string | string[] | undefined;
const primeiro = (v: Parametro) => (Array.isArray(v) ? v[0] : v);

export type Aba = "proximas" | "historico";

export function lerAba(v: Parametro): Aba {
  return primeiro(v) === "historico" ? "historico" : "proximas";
}

export const POR_PAGINA = 6;

// Página da URL sem confiar nela: inválida é a 1, além da última é a última.
export function paginar<T>(lista: T[], pagina: Parametro, porPagina = POR_PAGINA): { itens: T[]; pagina: number; totalPaginas: number } {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const v = primeiro(pagina);
  const pedida = v !== undefined && /^[1-9]\d{0,3}$/.test(v) ? Number(v) : 1;
  const atual = Math.min(pedida, totalPaginas);
  return { itens: lista.slice((atual - 1) * porPagina, atual * porPagina), pagina: atual, totalPaginas };
}

export function hrefLista(aba: Aba, pagina: number): string {
  const q = [aba === "historico" ? "aba=historico" : "", pagina > 1 ? `pagina=${pagina}` : ""].filter(Boolean).join("&");
  return q ? `/minhas-reservas?${q}` : "/minhas-reservas";
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// Selo do cartão: { semana: "seg", dia: "26" } no fuso de São Paulo.
export function seloData(inicio: Date): { semana: string; dia: string } {
  const dia = hojeLocal(inicio);
  return { semana: SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()], dia: String(Number(dia.slice(8))) };
}

// "18h às 20h" (o dia já está no selo).
export function textoHorario(inicio: Date, fim: Date): string {
  return `${textoMinutos(partesDoInstante(inicio).minuto)} às ${textoMinutos(minutoDoFim(fim))}`;
}

// "cancelamento grátis até dom 25, 18h": 24 h antes do início. Pago online não
// é grátis (a tarifa do Asaas não volta): "cancelamento até dom 25, 18h".
export function textoCancelaAte(inicio: Date, gratis = true): string {
  const limite = new Date(inicio.getTime() - 24 * 3_600_000);
  const { semana, dia } = seloData(limite);
  return `cancelamento${gratis ? " grátis" : ""} até ${semana} ${dia}, ${textoMinutos(partesDoInstante(limite).minuto)}`;
}

export function seloDaReserva(
  r: { situacao: string; canceladaPor: string | null; motivoCancelamento: string | null; fim: Date },
  agora: Date,
): { texto: string; tom: "ok" | "jogada" | "cancelada" | "aguardando" } {
  if (r.situacao === "segurada") return { texto: "Aguardando pagamento", tom: "aguardando" };
  if (r.situacao === "cancelada") return { texto: rotuloSituacao(r.situacao, r.canceladaPor, r.motivoCancelamento), tom: "cancelada" };
  return r.fim.getTime() > agora.getTime() ? { texto: "Confirmada", tom: "ok" } : { texto: "Jogada", tom: "jogada" };
}

// Segurada esperando o pagamento online: "Pague até 15h42 para garantir o horário."
export function textoPagarAte(seguraAte: Date): string {
  return `Pague até ${textoMinutos(partesDoInstante(seguraAte).minuto)} para garantir o horário.`;
}

// Situação do estorno de uma reserva paga online e cancelada.
export function textoEstornoReserva(r: { estorno: string | null; estornoCentavos: number | null }): string | null {
  if (r.estorno === "pendente") return "Estorno em análise pela Strukti.";
  if (r.estornoCentavos == null) return null;
  if (r.estorno === "solicitado") return `Estorno de ${textoDeCentavos(r.estornoCentavos)} a caminho.`;
  if (r.estorno === "concluido") return `Estorno de ${textoDeCentavos(r.estornoCentavos)} feito.`;
  return null;
}

// Volta à página da arena com a mesma quadra escolhida.
export function hrefReservarDeNovo(slug: string, quadraId: string): string {
  return `/a/${encodeURIComponent(slug)}?quadra=${encodeURIComponent(quadraId)}#reserva`;
}

import { formatarHorario } from "@/app/lib/formato";
import { ErroPainel } from "@/app/lib/painel";

// Textos do painel que têm alguma regra; o resto fica direto no JSX.

export const ERRO_GENERICO = "Algo deu errado. Tente de novo.";

export function textoCamera(camera: { online: boolean } | null): string {
  if (!camera) return "Sem câmera";
  return camera.online ? "Online" : "Offline";
}

// "visto há 3 min"; passado um dia, a data e a hora em São Paulo.
export function textoVistoHa(vistoEm: Date | null, agora: Date = new Date()): string {
  if (!vistoEm) return "nunca conectou";
  const min = Math.floor(Math.max(0, agora.getTime() - vistoEm.getTime()) / 60_000);
  if (min < 1) return "visto há menos de 1 min";
  if (min < 60) return `visto há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `visto há ${h} h`;
  return `visto em ${formatarHorario(vistoEm, agora)}`;
}

// ErroPainel já traz texto para o dono; qualquer outro erro vira a mensagem
// genérica e vai para o log só com nome, código e mensagem. Nunca o objeto
// inteiro: o `detail` do Postgres pode repetir a linha recusada (com a
// credencial cifrada), e nada do formulário entra no log.
export function mensagemDoErro(e: unknown, contexto: string): string {
  if (e instanceof ErroPainel) {
    const m = e.message.trim();
    return `${m.charAt(0).toUpperCase()}${m.slice(1)}${/[.!?]$/.test(m) ? "" : "."}`;
  }
  if (e instanceof Error) {
    const codigo = (e as { code?: unknown }).code;
    console.error(`[painel] ${contexto} falhou: ${e.name}${typeof codigo === "string" ? ` (${codigo})` : ""}: ${e.message}`);
  } else {
    console.error(`[painel] ${contexto} falhou: valor lançado não é Error (${typeof e})`);
  }
  return ERRO_GENERICO;
}

// ---------- Reservas ----------

// São Paulo é UTC−3 o ano todo (o Brasil não tem horário de verão desde 2019).
const OFFSET_SP_H = 3;

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^(\d{2}):(\d{2})(?::\d{2})?$/;

// "2026-10-17" + "08:00" digitados no horário de São Paulo → instante absoluto.
// null se algum dos dois for malformado ou impossível (30/02, 24:00).
export function instanteEmSaoPaulo(data: string, hora: string): Date | null {
  const d = RE_DATA.exec(data);
  const h = RE_HORA.exec(hora);
  if (!d || !h) return null;
  const [ano, mes, dia, hh, mm] = [d[1], d[2], d[3], h[1], h[2]].map(Number);
  if (hh > 23 || mm > 59) return null;
  const civil = new Date(Date.UTC(ano, mes - 1, dia));
  // Date.UTC aceita 30/02 e rola para março; a volta confere.
  if (civil.getUTCFullYear() !== ano || civil.getUTCMonth() !== mes - 1 || civil.getUTCDate() !== dia) return null;
  return new Date(Date.UTC(ano, mes - 1, dia, hh + OFFSET_SP_H, mm));
}

// Data + início + fim do formulário. Sem reserva que vira a noite: fim antes
// do início (ou igual) é erro, não "dia seguinte".
export function intervaloDaReserva(data: string, inicio: string, fim: string): { inicio: Date; fim: Date } {
  const i = instanteEmSaoPaulo(data, inicio);
  const f = instanteEmSaoPaulo(data, fim);
  if (!i || !f) throw new ErroPainel("horário inválido");
  if (f.getTime() <= i.getTime()) throw new ErroPainel("o fim precisa ser depois do início");
  return { inicio: i, fim: f };
}

const partesSP = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function emSP(d: Date): Record<string, string> {
  const p: Record<string, string> = {};
  for (const { type, value } of partesSP.formatToParts(d)) p[type] = value;
  return p;
}

// "8h", "8h30".
function horaCurta(d: Date): string {
  const p = emSP(d);
  return `${Number(p.hour)}h${p.minute === "00" ? "" : p.minute}`;
}

// "Reserva 8h–10h", no horário de São Paulo.
export function textoReserva(inicio: Date, fim: Date): string {
  return `Reserva ${horaCurta(inicio)}–${horaCurta(fim)}`;
}

// "17/10/2026": a data civil em São Paulo.
export function textoData(d: Date): string {
  const p = emSP(d);
  return `${p.day}/${p.month}/${p.year}`;
}

// URL do QR da arena, sem barra no fim do APP_URL. O slug é codificado para que
// o QR nunca carregue nada além de um caminho dentro de /a/.
export function urlDaArena(appUrl: string, slug: string): string {
  return `${appUrl.replace(/\/+$/, "")}/a/${encodeURIComponent(slug)}`;
}

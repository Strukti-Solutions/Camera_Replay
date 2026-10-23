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

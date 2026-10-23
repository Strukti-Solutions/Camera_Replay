import { formatarHorario } from "@/app/lib/formato";

// Regras de texto da página da arena (/a/<slug-da-arena>). Sem acesso a cookie nem a
// banco, para poder testar direto.


// "hoje", "ontem" ou "15/10": a parte do dia de formatarHorario ("hoje, 14:32").
export function textoDia(d: Date, agora: Date = new Date()): string {
  return formatarHorario(d, agora).split(",")[0];
}

export function textoLances(n: number): string {
  return n === 1 ? "1 lance" : `${n} lances`;
}

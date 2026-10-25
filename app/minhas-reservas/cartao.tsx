import { seloData } from "./apresentacao";

// Pedaços visuais do cartão, usados na lista e no detalhe.

// Selo da data: semana pequena em cima, dia grande. Azul nas próximas, cinza no histórico.
export function SeloData({ inicio, passada }: { inicio: Date; passada: boolean }) {
  const { semana, dia } = seloData(inicio);
  return (
    <span className={passada ? "rv-data rv-data-passada" : "rv-data"}>
      <small>{semana}</small>
      <b>{dia}</b>
    </span>
  );
}

export function SeloSituacao({ texto, tom }: { texto: string; tom: "ok" | "jogada" | "cancelada" }) {
  return <span className={`rv-selo rv-selo-${tom}`}>{texto}</span>;
}

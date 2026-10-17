import { redirect } from "next/navigation";

// A raiz não tem conteúdo próprio: o jogador entra por /a/<slug> (QR da arena)
// e o dono pelo painel.
export default function Inicio() {
  redirect("/painel");
}

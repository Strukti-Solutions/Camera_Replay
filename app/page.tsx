import { redirect } from "next/navigation";

// A raiz não tem conteúdo próprio: o jogador entra por /q/<slug> (QR code)
// e o dono pelo painel.
export default function Inicio() {
  redirect("/painel");
}

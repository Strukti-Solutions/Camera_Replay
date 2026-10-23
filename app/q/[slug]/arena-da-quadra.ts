import { notFound } from "next/navigation";
import { slugDaArenaDaQuadra } from "@/app/lib/arena-slug";
import { poolCompartilhado } from "@/app/lib/pool";

// Rotas antigas /q/<slug-da-quadra>: os QRs por quadra já impressos continuam
// valendo e levam (308) à área da arena da quadra. Slug malformado ou
// desconhecido dá 404, sem dizer qual dos dois.
export async function slugDaArenaOu404(slugQuadra: string): Promise<string> {
  const slugArena = await slugDaArenaDaQuadra(poolCompartilhado(), slugQuadra);
  if (!slugArena) notFound();
  return slugArena;
}

import { permanentRedirect } from "next/navigation";
import { ehUuid } from "@/app/a/[slug]/apresentacao";
import { slugDaArenaOu404 } from "../arena-da-quadra";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ r?: string | string[] }>;
};

// Só uuid segue em ?r=; qualquer outro valor é descartado.
export default async function EntrarAntigo({ params, searchParams }: Props) {
  const { slug } = await params;
  const { r } = await searchParams;
  const slugArena = await slugDaArenaOu404(slug);
  permanentRedirect(ehUuid(r) ? `/a/${slugArena}/entrar?r=${r}` : `/a/${slugArena}`);
}

import { notFound, permanentRedirect } from "next/navigation";
import { destinoAposEntrar, ehUuid } from "@/app/a/[slug]/apresentacao";
import { slugDaArenaOu404 } from "../../arena-da-quadra";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; reserva: string }> };

export default async function ReservaAntiga({ params }: Props) {
  const { slug, reserva } = await params;
  if (!ehUuid(reserva)) notFound();
  const destino = destinoAposEntrar(await slugDaArenaOu404(slug), reserva);
  if (!destino) notFound();
  permanentRedirect(destino);
}

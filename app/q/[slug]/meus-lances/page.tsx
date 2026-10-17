import { permanentRedirect } from "next/navigation";
import { slugDaArenaOu404 } from "../arena-da-quadra";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function MeusLancesAntigo({ params }: Props) {
  const { slug } = await params;
  permanentRedirect(`/a/${await slugDaArenaOu404(slug)}/meus-lances`);
}

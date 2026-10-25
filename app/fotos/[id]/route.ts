import { servirFoto } from "@/app/lib/fotos-envio";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";

export const dynamic = "force-dynamic";

// Foto pública da arena ou da quadra (divulgação). O bucket é privado: a foto
// passa por aqui, com cache de 1 dia. Sem R2 configurado, nada é servido.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = lerConfigR2();
  const r2 = config ? criarR2(config) : null;
  return servirFoto(poolCompartilhado(), async (chave) => (r2 ? r2.ler(chave) : null), id);
}

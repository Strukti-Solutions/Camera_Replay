import { servirFoto } from "@/app/lib/fotos-envio";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { sessaoAdminAtual } from "../../sessao-admin-atual";

export const dynamic = "force-dynamic";

// Foto vista pelo super admin, inclusive de arena suspensa (a rota pública
// /fotos não serve essas). Sem sessão de admin, 404 como foto inexistente.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sessaoAdminAtual())) {
    return new Response("Foto não encontrada.", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const { id } = await params;
  const config = lerConfigR2();
  const r2 = config ? criarR2(config) : null;
  return servirFoto(poolCompartilhado(), async (chave) => (r2 ? r2.ler(chave) : null), id, { admin: true });
}

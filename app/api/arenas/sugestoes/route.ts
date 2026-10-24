import { sugestoesArenas } from "../../../lib/arenas-publicas";
import { poolCompartilhado } from "../../../lib/pool";

export const dynamic = "force-dynamic";

// Sugestões da busca da home. Pública, só leitura; a validação do termo mora em
// sugestoesArenas (curto/longo/vazio devolvem lista vazia sem consultar).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const arenas = await sugestoesArenas(poolCompartilhado(), q);
  return Response.json({ arenas }, { headers: { "Cache-Control": "public, max-age=60" } });
}

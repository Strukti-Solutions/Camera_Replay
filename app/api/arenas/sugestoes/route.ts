import { sugestoesArenas } from "../../../lib/arenas-publicas";
import { poolCompartilhado } from "../../../lib/pool";

export const dynamic = "force-dynamic";

// Sugestões da busca da home. Pública, só leitura; a validação do termo mora em
// sugestoesArenas (curto/longo/vazio devolvem lista vazia sem consultar).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const arenas = await sugestoesArenas(poolCompartilhado(), q);
    return Response.json(
      { arenas },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=60" } },
    );
  } catch {
    // Sugestão é extra: falha vira lista vazia, sem cache e sem registrar o termo digitado.
    console.error("sugestoes: falha ao consultar o banco");
    return Response.json({ arenas: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}

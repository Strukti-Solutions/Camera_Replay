import { registrarAperto } from "./aperto";
import type { Db } from "./db";

const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SEM_CACHE = { "cache-control": "no-store" };

const json = (corpo: unknown, status: number) =>
  Response.json(corpo, { status, headers: SEM_CACHE });

// Só aceita "Bearer <token>" com o token no formato exato. Qualquer outra coisa
// (ausente, outro esquema, espaço no meio, tamanho errado) vira null, sem tocar no banco.
function lerToken(req: Request): string | null {
  const m = /^Bearer\s+(.*)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  const token = m?.[1].trim() ?? "";
  return FORMATO_TOKEN.test(token) ? token : null;
}

export function criarHandlerAperto(db: Db): (req: Request) => Promise<Response> {
  return async (req) => {
    const token = lerToken(req);
    if (!token) return json({ erro: "token inválido" }, 401);
    try {
      const r = await registrarAperto(db, token);
      // Inexistente e revogado: mesma resposta.
      if (!r) return json({ erro: "token inválido" }, 401);
      return json({ clipe_id: r.clipeId, duplicado: r.duplicado }, 202);
    } catch (e) {
      console.error("falha ao registrar aperto", e);
      return json({ erro: "erro interno" }, 500);
    }
  };
}

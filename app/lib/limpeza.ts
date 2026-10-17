import { createHash, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { chaveDoClipe } from "./r2";

export type ApagadorR2 = { apagar(chave: string): Promise<void> };
export type ResultadoLimpeza = { apagados: number; erros: number; presos: number };

const SEM_CACHE = { "cache-control": "no-store" };
const json = (corpo: unknown, status: number) =>
  Response.json(corpo, { status, headers: SEM_CACHE });

const mensagem = (e: unknown) => (e instanceof Error ? e.message : "erro desconhecido");

// Roda o reaper e apaga os clipes expirados: primeiro o objeto no R2, depois a
// linha. Se o R2 falhar, a linha fica (a próxima rodada tenta de novo; DELETE no
// R2 é idempotente) e a rodada segue para o próximo clipe. Erro do banco na
// consulta inicial sobe para quem chamou.
//
// Pendência registrada no plano (objeto órfão): a rede de segurança que varre o
// prefixo clipes/ atrás de objetos sem linha ficaria AQUI, depois do laço, como
// um passo à parte. Não é feita agora porque não está no plano da Tarefa 7.
export async function limparExpirados(
  db: Db,
  r2: ApagadorR2,
  limite = 500,
): Promise<ResultadoLimpeza> {
  const presosRes = await db.query<{ n: number }>("select expirar_presos() as n");
  const presos = Number(presosRes.rows[0]?.n ?? 0);

  const { rows } = await db.query<{ id: string; arena_id: string; chave_r2: string | null }>(
    `select id, arena_id, chave_r2 from clipes
      where expira_em < now()
      order by expira_em
      limit $1`,
    [limite],
  );

  let apagados = 0;
  let erros = 0;
  for (const c of rows) {
    try {
      // Só apaga o objeto que o worker gravaria para este clipe. Uma chave de
      // outro clipe ou de outra arena (linha adulterada ou bug) não é apagada.
      if (c.chave_r2 && c.chave_r2 !== chaveDoClipe(c.arena_id, c.id)) {
        throw new Error("chave_r2 diverge de chaveDoClipe");
      }
      if (c.chave_r2) await r2.apagar(c.chave_r2);
      await db.query("delete from clipes where id = $1 and arena_id = $2", [c.id, c.arena_id]);
      apagados++;
    } catch (e) {
      erros++;
      // Só o id do clipe e a mensagem; nunca credencial.
      console.error(`limpeza: clipe ${c.id} não apagado:`, mensagem(e));
    }
  }
  return { apagados, erros, presos };
}

// Compara hashes SHA-256 dos dois lados: tamanho fixo, então timingSafeEqual
// não lança e o tempo não revela o comprimento do segredo.
function segredoConfere(recebido: string, esperado: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(recebido), h(esperado));
}

function lerBearer(req: Request): string {
  const m = /^Bearer\s+(.*)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  return m?.[1].trim() ?? "";
}

// 503 sem CRON_SECRET (decidido antes de olhar a requisição: não revela nada);
// 401 igual para qualquer segredo errado; 503 sem R2 só depois de autenticar.
export function criarHandlerLimpeza(
  db: Db,
  r2: ApagadorR2 | null,
  segredo: string | undefined,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!segredo) return json({ erro: "cron não configurado" }, 503);
    if (!segredoConfere(lerBearer(req), segredo)) return json({ erro: "não autorizado" }, 401);
    if (!r2) return json({ erro: "R2 não configurado" }, 503);
    try {
      return json(await limparExpirados(db, r2), 200);
    } catch (e) {
      console.error("limpeza: falha:", mensagem(e));
      return json({ erro: "erro interno" }, 500);
    }
  };
}

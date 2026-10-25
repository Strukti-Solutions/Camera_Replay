import type { Db } from "./db";
import { FOTO_MAX_BYTES, fotoParaServir, reservarFoto, tipoDaImagem } from "./fotos";

// Envio e leitura das fotos sem nada do Next, para poder testar direto.

export const MSG_ENVIO_FALHOU = "Não foi possível enviar a foto. Tente de novo.";
export const MSG_SEM_ARMAZENAMENTO = "Armazenamento de fotos não configurado.";

type Enviar = { enviar(chave: string, corpo: Uint8Array, tipo: string): Promise<void> };

// Valida antes de tocar no banco; grava a linha e depois manda ao R2. Se o R2
// falhar, a linha é apagada (nada fica apontando para um arquivo que não existe).
export async function enviarFoto(
  db: Db, r2: Enviar, arenaId: string, quadraId: string | null, bytes: Uint8Array,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (bytes.length > FOTO_MAX_BYTES) return { ok: false, erro: "Foto grande demais (máximo 2 MB)." };
  const tipo = tipoDaImagem(bytes);
  if (!tipo) return { ok: false, erro: "Envie uma foto JPEG, PNG ou WebP." };
  const linha = await reservarFoto(db, arenaId, quadraId, tipo, bytes.length);
  if (!linha.ok) return linha;
  try {
    await r2.enviar(linha.chave, bytes, tipo);
  } catch (e) {
    await db.query("delete from fotos where id = $1", [linha.id]);
    console.error("foto: envio ao R2 falhou:", e instanceof Error ? e.message : e);
    return { ok: false, erro: MSG_ENVIO_FALHOU };
  }
  return { ok: true };
}

// Rota pública /fotos/<id>. Cache de 1 dia: foto apagada some em até um dia.
export async function servirFoto(
  db: Pick<Db, "query">, ler: (chave: string) => Promise<Response | null>, fotoId: string,
): Promise<Response> {
  const naoAchou = () => new Response("Foto não encontrada.", { status: 404, headers: { "cache-control": "no-store" } });
  const foto = await fotoParaServir(db, fotoId);
  if (!foto) return naoAchou();
  let res: Response | null;
  try {
    res = await ler(foto.chave);
  } catch (e) {
    console.error("foto: leitura no R2 falhou:", e instanceof Error ? e.message : e);
    return new Response("Foto indisponível no momento.", { status: 502, headers: { "cache-control": "no-store" } });
  }
  if (!res) return naoAchou();
  return new Response(res.body, {
    status: 200,
    headers: { "content-type": foto.tipo, "cache-control": "public, max-age=86400" },
  });
}

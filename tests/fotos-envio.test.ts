import { expect, test } from "vitest";
import { listarFotos, reservarFoto, FOTO_MAX_BYTES } from "../app/lib/fotos";
import { enviarFoto, servirFoto, MSG_ENVIO_FALHOU } from "../app/lib/fotos-envio";
import { ErroR2 } from "../app/lib/r2";
import { novoBanco } from "./db";
import { criarArena, criarQuadra } from "./fixtures";

const WEBP = new Uint8Array([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBPVP8 "), 9, 9]);

function r2Falso(falhar = false) {
  const enviados: { chave: string; tipo: string; bytes: number }[] = [];
  return {
    enviados,
    async enviar(chave: string, corpo: Uint8Array, tipo: string) {
      if (falhar) throw new ErroR2("PUT no R2 falhou (500)", 500);
      enviados.push({ chave, tipo, bytes: corpo.length });
    },
  };
}

test("enviar foto: valida, grava a linha e manda ao R2 com a chave da linha", async () => {
  const db = await novoBanco();
  const arena = await criarArena(db);
  const quadra = await criarQuadra(db, arena.id);
  const r2 = r2Falso();
  expect(await enviarFoto(db, r2, arena.id, quadra.id, WEBP)).toEqual({ ok: true });
  const [f] = await listarFotos(db, arena.id, quadra.id);
  expect(f).toMatchObject({ tipo: "image/webp", bytes: WEBP.length, posicao: 0 });
  expect(r2.enviados).toEqual([{ chave: `fotos/${arena.id}/${f.id}.webp`, tipo: "image/webp", bytes: WEBP.length }]);
});

test("enviar foto: tamanho, formato falso e limite são recusados antes do R2", async () => {
  const db = await novoBanco();
  const arena = await criarArena(db);
  const r2 = r2Falso();
  const grande = new Uint8Array(FOTO_MAX_BYTES + 1);
  grande.set(WEBP);
  expect(await enviarFoto(db, r2, arena.id, null, grande)).toEqual({ ok: false, erro: "Foto grande demais (máximo 2 MB)." });
  expect(await enviarFoto(db, r2, arena.id, null, new Uint8Array(Buffer.from("<svg/>")))).toEqual({
    ok: false, erro: "Envie uma foto JPEG, PNG ou WebP.",
  });
  expect(await enviarFoto(db, r2, arena.id, null, new Uint8Array())).toEqual({ ok: false, erro: "Envie uma foto JPEG, PNG ou WebP." });
  for (let i = 0; i < 10; i++) await reservarFoto(db, arena.id, null, "image/webp", 1);
  expect(await enviarFoto(db, r2, arena.id, null, WEBP)).toEqual({ ok: false, erro: "A arena já tem 10 fotos." });
  expect(r2.enviados).toEqual([]);
});

test("enviar foto: falha do R2 desfaz a linha", async () => {
  const db = await novoBanco();
  const arena = await criarArena(db);
  expect(await enviarFoto(db, r2Falso(true), arena.id, null, WEBP)).toEqual({ ok: false, erro: MSG_ENVIO_FALHOU });
  expect(await listarFotos(db, arena.id, null)).toEqual([]);
});

test("servir foto: 404 sem foto, 200 com tipo e cache de 1 dia, 502 se o R2 falhar", async () => {
  const db = await novoBanco();
  const arena = await criarArena(db);
  const r = await reservarFoto(db, arena.id, null, "image/png", 3);
  if (!r.ok) throw new Error(r.erro);
  const chaves: string[] = [];
  const ler = async (chave: string) => {
    chaves.push(chave);
    return new Response("png!");
  };

  const ok = await servirFoto(db, ler, r.id);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/png");
  expect(ok.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
  expect(ok.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  expect(await ok.text()).toBe("png!");
  expect(chaves).toEqual([r.chave]);

  expect((await servirFoto(db, ler, "nao-e-uuid")).status).toBe(404);
  expect((await servirFoto(db, ler, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
  expect((await servirFoto(db, async () => null, r.id)).status).toBe(404);

  const falha = await servirFoto(db, async () => { throw new ErroR2("GET no R2 falhou (500)", 500); }, r.id);
  expect(falha.status).toBe(502);
  expect(falha.headers.get("cache-control")).toBe("no-store");
});

test("servirFoto: arena suspensa some da rota pública; o modo admin ainda serve, sem cache público", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const r = await reservarFoto(db, a.id, null, "image/webp", 10);
  if (!r.ok) throw new Error(r.erro);
  const ler = async () => new Response("bytes");
  await db.query("update arenas set status_assinatura = 'suspensa' where id = $1", [a.id]);
  expect((await servirFoto(db, ler, r.id)).status).toBe(404);
  const adm = await servirFoto(db, ler, r.id, { admin: true });
  expect(adm.status).toBe(200);
  expect(adm.headers.get("cache-control")).toBe("private, max-age=300");
  expect((await servirFoto(db, ler, "nao-e-uuid", { admin: true })).status).toBe(404);
});

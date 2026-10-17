import { createHash, createHmac } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { ErroR2, VALIDADE_LEITURA_S, chaveDoClipe, criarR2, lerConfigR2 } from "../app/lib/r2";

const config = {
  accountId: "conta123",
  accessKeyId: "AKIAEXEMPLO",
  secretAccessKey: "segredo-super-secreto",
  bucket: "replays",
};

afterEach(() => vi.useRealTimers());

const resposta = (status: number) => async () => new Response(null, { status });

test("urlLeitura vale 15 min, é assinada e aponta para o host e bucket certos", async () => {
  const url = new URL(await criarR2(config).urlLeitura("clipes/a/b.mp4"));
  expect(VALIDADE_LEITURA_S).toBe(900);
  expect(url.host).toBe("conta123.r2.cloudflarestorage.com");
  expect(url.pathname).toBe("/replays/clipes/a/b.mp4");
  expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
});

// SigV4 de URL pré-assinada calculado à mão com node:crypto, independente do aws4fetch.
const hmac = (k: string | Buffer, s: string) => createHmac("sha256", k).update(s).digest();
const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function assinaturaEsperada(url: URL, segredo: string, regiao: string, metodo: string): string {
  const data = url.searchParams.get("X-Amz-Date")!;
  const dia = data.slice(0, 8);
  const consulta = [...url.searchParams]
    .filter(([k]) => k !== "X-Amz-Signature")
    .map(([k, v]) => [pct(k), pct(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((p) => p.join("="))
    .join("&");
  const caminho = url.pathname; // já codificado uma vez (S3 não codifica de novo)
  const canonica = [metodo, caminho, consulta, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const escopo = `${dia}/${regiao}/s3/aws4_request`;
  const aSerAssinado = ["AWS4-HMAC-SHA256", data, escopo, createHash("sha256").update(canonica).digest("hex")].join("\n");
  const chave = hmac(hmac(hmac(hmac("AWS4" + segredo, dia), regiao), "s3"), "aws4_request");
  return createHmac("sha256", chave).update(aSerAssinado).digest("hex");
}

test("urlLeitura: vetor fixo de SigV4 (credencial, headers assinados e assinatura)", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T12:34:56Z"));
  for (const chave of ["clipes/a/b.mp4", "clipes/a b/c#d+e.mp4"]) {
    const url = new URL(await criarR2(config).urlLeitura(chave));
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261016T123456Z");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AKIAEXEMPLO/20261016/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toBe(
      assinaturaEsperada(url, config.secretAccessKey, "auto", "GET"),
    );
  }
});

test("urlLeitura não vaza o segredo e codifica cada segmento", async () => {
  const bruta = await criarR2(config).urlLeitura("clipes/a b/c#d.mp4");
  expect(bruta).not.toContain(config.secretAccessKey);
  expect(new URL(bruta).pathname).toBe("/replays/clipes/a%20b/c%23d.mp4");
});

test("apagar faz DELETE e aceita 204 e 404", async () => {
  for (const status of [204, 404]) {
    const fetcher = vi.fn(resposta(status));
    await criarR2(config, fetcher as unknown as typeof fetch).apagar("clipes/a/b.mp4");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(new URL(url).pathname).toBe("/replays/clipes/a/b.mp4");
    expect(init.cache).toBe("no-store");
    const auth = new Headers(init.headers).get("authorization") ?? "";
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(auth).toMatch(/Credential=AKIAEXEMPLO\/\d{8}\/auto\/s3\/aws4_request/);
  }
});

test("apagar com 500 lança ErroR2 com status 500", async () => {
  const r2 = criarR2(config, resposta(500) as unknown as typeof fetch);
  const erro = await r2.apagar("clipes/a/b.mp4").catch((e) => e);
  expect(erro).toBeInstanceOf(ErroR2);
  expect(erro.status).toBe(500);
});

test("erro de rede vira ErroR2 com status 0, sem expor o segredo", async () => {
  const fetcher = async () => {
    throw new Error("ECONNRESET");
  };
  const erro = await criarR2(config, fetcher as unknown as typeof fetch)
    .apagar("clipes/a/b.mp4")
    .catch((e) => e);
  expect(erro).toBeInstanceOf(ErroR2);
  expect(erro.status).toBe(0);
  expect(erro.message).toContain("ECONNRESET");
  expect(erro.message).not.toContain(config.secretAccessKey);
});

test("lerConfigR2 lê as variáveis R2_*", () => {
  expect(
    lerConfigR2({
      R2_ACCOUNT_ID: " conta123 ",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET: "replays",
    }),
  ).toEqual({ accountId: "conta123", accessKeyId: "k", secretAccessKey: "s", bucket: "replays" });
});

test("lerConfigR2 devolve null se faltar qualquer variável", () => {
  const completo = { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" };
  for (const faltando of Object.keys(completo)) {
    const env = { ...completo, [faltando]: undefined };
    expect(lerConfigR2(env)).toBeNull();
  }
  expect(lerConfigR2({ ...completo, R2_BUCKET: "  " })).toBeNull();
});

test("chaveDoClipe monta clipes/<arena>/<clipe>.mp4", () => {
  expect(chaveDoClipe("a", "b")).toBe("clipes/a/b.mp4");
});

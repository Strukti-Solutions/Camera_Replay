import { AwsClient } from "aws4fetch";

// Porte enxuto de strukti-site/src/lib/bancada/r2.ts: leitura assinada e
// DELETE dos clipes (o upload deles é do worker), e envio e leitura das fotos
// do painel. O bucket é privado; nada aqui loga segredo.

export type ConfigR2 = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export class ErroR2 extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const VALIDADE_LEITURA_S = 15 * 60;

// null se faltar qualquer variável R2_* (ou vier em branco).
export function lerConfigR2(
  env: Record<string, string | undefined> = process.env,
): ConfigR2 | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function chaveDoClipe(arenaId: string, clipeId: string): string {
  return `clipes/${arenaId}/${clipeId}.mp4`;
}

// Capa opcional do lance, ao lado do vídeo. O worker a envia antes de marcar_pronto.
export function chaveDaCapa(arenaId: string, clipeId: string): string {
  return `clipes/${arenaId}/${clipeId}.jpg`;
}

// Só letras, números, ponto, sublinhado e hífen: nada que quebre o cabeçalho.
const saneiaNome = (nome: string) => nome.replace(/[^A-Za-z0-9._-]/g, "_");

export function criarR2(config: ConfigR2, fetcher: typeof fetch = fetch) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  const urlDe = (chave: string) => `${base}/${chave.split("/").map(encodeURIComponent).join("/")}`;

  // Falha de rede (DNS, TLS, R2 fora do ar) vira ErroR2 com status 0.
  async function chamar(assinada: Request, metodo: string): Promise<Response> {
    try {
      return await fetcher(assinada.url, {
        method: metodo,
        headers: assinada.headers,
        body: metodo === "PUT" ? await assinada.arrayBuffer() : undefined,
        cache: "no-store",
      });
    } catch (error) {
      throw new ErroR2(`sem conexão com o R2 (${error instanceof Error ? error.message : "erro de rede"})`, 0);
    }
  }

  return {
    // URL assinada de GET, válida por 15 min. Com baixarComo, o R2 responde com
    // Content-Disposition: attachment; o parâmetro entra antes da assinatura.
    async urlLeitura(chave: string, opcoes?: { baixarComo?: string }): Promise<string> {
      const url = new URL(urlDe(chave));
      if (opcoes?.baixarComo) {
        url.searchParams.set(
          "response-content-disposition",
          `attachment; filename="${saneiaNome(opcoes.baixarComo)}"`,
        );
      }
      url.searchParams.set("X-Amz-Expires", String(VALIDADE_LEITURA_S));
      const assinada = await client.sign(url.toString(), {
        method: "GET",
        aws: { signQuery: true },
      });
      return assinada.url;
    },

    // PUT de um objeto pequeno (fotos). Qualquer status fora de 2xx vira ErroR2.
    async enviar(chave: string, corpo: Uint8Array, tipo: string): Promise<void> {
      const assinada = await client.sign(urlDe(chave), {
        method: "PUT",
        headers: { "content-type": tipo },
        body: corpo as Uint8Array<ArrayBuffer>,
      });
      const res = await chamar(assinada, "PUT");
      if (!res.ok) throw new ErroR2(`PUT no R2 falhou (${res.status})`, res.status);
    },

    // GET assinado no cabeçalho; 404 = null.
    async ler(chave: string): Promise<Response | null> {
      const assinada = await client.sign(urlDe(chave), { method: "GET" });
      const res = await chamar(assinada, "GET");
      if (res.status === 404) return null;
      if (!res.ok) throw new ErroR2(`GET no R2 falhou (${res.status})`, res.status);
      return res;
    },

    // 204 e 404 contam como sucesso (apagar é idempotente).
    async apagar(chave: string): Promise<void> {
      const assinada = await client.sign(urlDe(chave), { method: "DELETE" });
      const res = await chamar(assinada, "DELETE");
      if (!res.ok && res.status !== 404) {
        throw new ErroR2(`DELETE no R2 falhou (${res.status})`, res.status);
      }
    },
  };
}

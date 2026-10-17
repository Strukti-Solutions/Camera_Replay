import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Credenciais da câmera em repouso: AES-256-GCM, formato
// v1:<iv 12 B>:<tag 16 B>:<cifra>, cada parte em base64. O worker Python
// decifra o mesmo formato (tests/vetor-credenciais.json). Nenhuma mensagem de
// erro daqui inclui credencial, chave ou o texto recebido.

export type CredenciaisCamera = { authcode: string; local_user: string; local_pwd: string };

const TAM_CHAVE = 32;
const TAM_IV = 12;
const TAM_TAG = 16;
const ALGORITMO = "aes-256-gcm";

const strictB64 = (s: string): Buffer | null => {
  const b = Buffer.from(s, "base64");
  return b.toString("base64") === s ? b : null;
};

// CAMERA_CRED_KEY: 32 bytes em base64 (ex.: `openssl rand -base64 32`).
export function lerChave(env: Record<string, string | undefined> = process.env): Buffer {
  const bruta = env.CAMERA_CRED_KEY?.trim();
  const chave = bruta ? strictB64(bruta) : null;
  if (!chave || chave.length !== TAM_CHAVE) {
    throw new Error("CAMERA_CRED_KEY ausente ou inválida: precisa ser base64 de exatamente 32 bytes");
  }
  return chave;
}

function exigirChave(chave: Buffer): void {
  if (!Buffer.isBuffer(chave) || chave.length !== TAM_CHAVE) {
    throw new Error("chave de credenciais inválida: precisa ter 32 bytes");
  }
}

// `iv` existe só para o vetor fixo dos testes; em produção é sempre aleatório.
export function cifrarCredenciais(
  c: CredenciaisCamera,
  chave: Buffer,
  iv: Buffer = randomBytes(TAM_IV),
): string {
  exigirChave(chave);
  if (iv.length !== TAM_IV) throw new Error("IV inválido: precisa ter 12 bytes");
  const { authcode, local_user, local_pwd } = c;
  const cifra = createCipheriv(ALGORITMO, chave, iv, { authTagLength: TAM_TAG });
  const dados = Buffer.concat([
    cifra.update(JSON.stringify({ authcode, local_user, local_pwd }), "utf8"),
    cifra.final(),
  ]);
  return ["v1", iv, cifra.getAuthTag(), dados].map((p) => (typeof p === "string" ? p : p.toString("base64"))).join(":");
}

const INVALIDO = "credenciais cifradas inválidas";

export function decifrarCredenciais(s: string, chave: Buffer): CredenciaisCamera {
  exigirChave(chave);
  const partes = typeof s === "string" ? s.split(":") : [];
  if (partes.length !== 4 || partes[0] !== "v1") throw new Error(INVALIDO);
  const iv = strictB64(partes[1]);
  const tag = strictB64(partes[2]);
  const dados = strictB64(partes[3]);
  if (!iv || !tag || !dados || iv.length !== TAM_IV || tag.length !== TAM_TAG) throw new Error(INVALIDO);

  let texto: string;
  try {
    const d = createDecipheriv(ALGORITMO, chave, iv, { authTagLength: TAM_TAG });
    d.setAuthTag(tag);
    texto = Buffer.concat([d.update(dados), d.final()]).toString("utf8");
  } catch {
    // Tag não confere (adulteração ou chave errada): sem repassar a causa.
    throw new Error(INVALIDO);
  }

  let obj: unknown;
  try {
    obj = JSON.parse(texto);
  } catch {
    throw new Error(INVALIDO);
  }
  const o = obj as Record<string, unknown> | null;
  if (
    !o ||
    typeof o !== "object" ||
    typeof o.authcode !== "string" ||
    typeof o.local_user !== "string" ||
    typeof o.local_pwd !== "string"
  ) {
    throw new Error(INVALIDO);
  }
  return { authcode: o.authcode, local_user: o.local_user, local_pwd: o.local_pwd };
}

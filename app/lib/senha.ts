import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Formato: scrypt$N$r$p$<sal b64>$<hash b64>. Os parâmetros ficam no próprio
// hash, então dá para aumentá-los depois sem invalidar os antigos.
const N = 32768, R = 8, P = 1;
const TAM_SAL = 16, TAM_CHAVE = 64;
const MAXMEM = 64 * 1024 * 1024;

function derivar(senha: string, sal: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const opcoes: ScryptOptions = { N: n, r, p, maxmem: MAXMEM };
  return new Promise((resolve, reject) => {
    scrypt(senha, sal, TAM_CHAVE, opcoes, (erro, chave) => (erro ? reject(erro) : resolve(chave)));
  });
}

export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(TAM_SAL);
  const chave = await derivar(senha, sal, N, R, P);
  return `scrypt$${N}$${R}$${P}$${sal.toString("base64")}$${chave.toString("base64")}`;
}

// Hash malformado ou com parâmetros absurdos devolve false; nunca lança.
export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  try {
    const partes = hash.split("$");
    if (partes.length !== 6 || partes[0] !== "scrypt") return false;
    const [n, r, p] = [partes[1], partes[2], partes[3]].map(Number);
    if (![n, r, p].every(Number.isInteger) || n < 2 || (n & (n - 1)) !== 0 || r < 1 || p < 1) return false;
    if (128 * n * r > MAXMEM) return false;
    const sal = Buffer.from(partes[4], "base64");
    const esperado = Buffer.from(partes[5], "base64");
    if (sal.length === 0 || esperado.length !== TAM_CHAVE) return false;
    const obtido = await derivar(senha, sal, n, r, p);
    return timingSafeEqual(obtido, esperado);
  } catch {
    return false;
  }
}

// Senha mínima de dono e de super admin. A do jogador (8) fica em jogadores.ts.
// Moram aqui para o "Esqueci a senha" (recuperar-senha.ts) aplicar o mínimo de
// cada tipo sem importar plataforma.ts, que só /admin pode importar.
export const SENHA_MIN_DONO = 10;
export const SENHA_MIN_ADMIN = 12;

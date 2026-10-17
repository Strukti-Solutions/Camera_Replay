import { createHash, randomBytes } from "node:crypto";

// Token do botão: 32 bytes aleatórios em base64url.
export function novoToken(): string {
  return randomBytes(32).toString("base64url");
}

// Só o hash SHA-256 (hex) vai para o banco.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Slug público da quadra: 16 bytes em base64url dão 22 caracteres.
export function novoSlug(): string {
  return randomBytes(16).toString("base64url");
}

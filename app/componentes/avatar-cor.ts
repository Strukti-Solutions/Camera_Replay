// Cor e iniciais do avatar da pessoa. Módulo sem dependências: o avatar
// aparece também em componentes de cliente, que não podem puxar app/lib.

// Fundos do avatar. Todos com contraste ≥ 4,5:1 contra as iniciais brancas,
// e escuros o bastante para aparecer também sobre o fundo do tema escuro.
export const PALETA_AVATAR = [
  "#1a5aa0", // azul da quadra
  "#1d6b3a", // verde
  "#b42318", // vermelho
  "#6b3fa0", // roxo
  "#8a4b08", // terra
  "#0f6466", // petróleo
  "#a3236b", // magenta
  "#4a5d70", // ardósia
] as const;

// FNV-1a de 32 bits: mesmo id, mesma cor, em qualquer servidor.
export function corDoAvatar(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PALETA_AVATAR[(h >>> 0) % PALETA_AVATAR.length];
}

// Primeira letra do primeiro e do último nome, em maiúscula.
export function iniciais(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return "?";
  const letra = (p: string) => (Array.from(p)[0] ?? "").toLocaleUpperCase("pt-BR");
  const primeira = letra(palavras[0]);
  return palavras.length > 1 ? primeira + letra(palavras[palavras.length - 1]) : primeira;
}

// Busca sem acento e sem maiúscula, igual no JavaScript e no SQL.

// Minúsculas e maiúsculas na tabela: não depende da localidade do banco para o lower() das maiúsculas acentuadas.
const ACENTOS = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuucn".repeat(2);

// Termo sem NUL (o Postgres recusa), aparado, até 80 caracteres, minúsculo e sem
// acento. Os dois lados da comparação passam pela mesma normalização.
export function normalizar(busca: unknown): string {
  if (typeof busca !== "string") return "";
  return busca
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Expressão SQL equivalente para uma coluna de texto (nula vira vazio). `col` é
// sempre um nome fixo do código, nunca texto do usuário. O normalize(NFC) junta
// letra + acento solto (texto gravado em NFD) para o translate reconhecer.
export const sqlNorm = (col: string) =>
  `translate(lower(normalize(coalesce(${col}, ''), NFC)), '${ACENTOS}', '${SEM_ACENTO}')`;

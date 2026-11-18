import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { TERMOS_VERSAO } from "../app/lib/jogadores";

// Criar a conta grava TERMOS_VERSAO em jogadores.termos_versao: é o registro
// de qual texto de /termos a pessoa aceitou (LGPD). Cada versão fica ligada
// aqui ao hash do texto da página. Mudou o texto? Suba TERMOS_VERSAO e
// acrescente a versão nova no fim da lista com o hash que o teste mostrar;
// nunca edite a linha de uma versão que alguém já aceitou.
const VERSOES: [versao: string, sha256: string][] = [
  // Lances guardados por até 3 dias (migração 0007).
  ["provisorio-2026-10-22", "02afa1b488ff6f7c2647d8cdae82e67068c01a64df59395e555ff6c48a1b90d1"],
  // Lances guardados por até 7 dias (migração 0024, decisão do Thiago em 26/10).
  ["provisorio-2026-10-26", "7c7691730173b666a6a71115a85b90fd683bd8a32afe0923aa591f45f3429e93"],
];

// O que a pessoa lê: o conteúdo do <main> da página, sem as tags e com os
// espaços normalizados. Trocar classe, componente ou indentação não muda a
// versão; trocar uma palavra muda.
function textoDosTermos(fonte: string): string {
  const inicio = fonte.indexOf("<main");
  const fim = fonte.indexOf("</main>");
  if (inicio < 0 || fim < inicio) throw new Error("app/termos/page.tsx sem <main>");
  return fonte
    .slice(inicio, fim)
    .replace(/<[^>]*>/g, " ")
    .replace(/\{" "\}/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const sha256 = (texto: string) => createHash("sha256").update(texto, "utf8").digest("hex");

const textoAtual = () => textoDosTermos(readFileSync("app/termos/page.tsx", "utf8"));

test("o texto de /termos é o da versão gravada no aceite (TERMOS_VERSAO)", () => {
  const hash = sha256(textoAtual());
  const daVersao = VERSOES.find(([v]) => v === TERMOS_VERSAO)?.[1];
  expect(
    daVersao,
    `o texto de /termos mudou (sha256 ${hash}): suba TERMOS_VERSAO em app/lib/jogadores.ts e acrescente a versão nova em VERSOES`,
  ).toBe(hash);
});

test("a versão atual é a última da lista e cada versão tem um texto próprio", () => {
  expect(VERSOES.at(-1)?.[0]).toBe(TERMOS_VERSAO);
  expect(new Set(VERSOES.map(([v]) => v)).size).toBe(VERSOES.length);
  expect(new Set(VERSOES.map(([, h]) => h)).size).toBe(VERSOES.length);
});

test("os termos dizem 7 dias, a retenção da migração 0024", () => {
  expect(textoAtual()).toContain("Os vídeos dos lances (replays) da quadra, por até 7 dias. Depois disso eles são apagados.");
  expect(textoAtual()).not.toContain("3 dias");
});

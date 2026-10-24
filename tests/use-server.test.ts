import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// Next só aceita export de função async em arquivo "use server": constante,
// função síncrona ou classe quebram a compilação (type/interface somem).
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : arquivos(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

// A diretiva só vale no topo do arquivo (depois de comentários e espaços).
const DIRETIVA = /^﻿?\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use server["']/;
const PERMITIDO = /^export\s+(?:type|interface|async\s+function|default\s+async\s+function)\b/;
const PROIBIDO = /^export\s+(?:const|let|var|class|function\b|default\b)/;

function violacoesUseServer(conteudo: string): string[] {
  if (!DIRETIVA.test(conteudo)) return [];
  const achados: string[] = [];
  conteudo.split(/\r?\n/).forEach((linha, i) => {
    const l = linha.trim();
    if (PERMITIDO.test(l)) return;
    if (PROIBIDO.test(l)) achados.push(`${i + 1}: ${l}`);
  });
  return achados;
}

test("arquivos 'use server' só exportam funções async", () => {
  const problemas = arquivos("app").flatMap((f) =>
    violacoesUseServer(readFileSync(f, "utf8")).map((v) => `${f}:${v}`),
  );
  expect(problemas).toEqual([]);
});

test("guarda: casos-controle sintéticos", () => {
  expect(violacoesUseServer('// nota\n\n"use server"\nexport const x = 1;\n')).toHaveLength(1);
  expect(violacoesUseServer('﻿  // a\n  /* b */\n  \'use server\';\nexport function f() {}\n')).toHaveLength(1);
  expect(violacoesUseServer('"use server";\nexport default async function f(){}\n')).toEqual([]);
  expect(violacoesUseServer('"use server";\nexport default function f(){}\n')).toHaveLength(1);
  expect(violacoesUseServer('"use server";\nexport type T = 1;\nexport interface I {}\nexport async function g(){}\n')).toEqual([]);
  expect(violacoesUseServer("export const x = 1;\n")).toEqual([]);
  expect(violacoesUseServer('export async function h() {\n  "use server";\n}\nexport const y = 2;\n')).toEqual([]);
});

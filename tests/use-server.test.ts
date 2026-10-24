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

const PROIBIDO = /^export\s+(?:const|let|var|class|function\b)/;

test("arquivos 'use server' só exportam funções async", () => {
  const problemas: string[] = [];
  for (const f of arquivos("app")) {
    const src = readFileSync(f, "utf8");
    if (!/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(src)) continue;
    src.split(/\r?\n/).forEach((linha, i) => {
      const l = linha.trim();
      if (!l.startsWith("export")) return;
      if (/^export\s+(type|interface)\b/.test(l) || /^export\s+async\s+function\b/.test(l)) return;
      if (PROIBIDO.test(l) || /^export\s+default\b/.test(l)) problemas.push(`${f}:${i + 1}: ${l}`);
    });
  }
  expect(problemas).toEqual([]);
});

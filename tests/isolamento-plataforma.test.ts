import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// app/lib/plataforma.ts cruza arenas: só /admin (e os scripts de db/) podem
// importá-lo. Esta varredura falha se qualquer outro arquivo de app/ o fizer.

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const APP = join(RAIZ, "app");

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

// import ... from "…plataforma", import("…plataforma"), require("…plataforma"),
// export ... from "…plataforma" — com ou sem extensão.
const IMPORTA_PLATAFORMA = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'][^"']*\/plataforma(?:\.tsx?|\.js)?["']/;

test("só app/admin importa app/lib/plataforma", () => {
  const proibidos = arquivos(APP)
    .map((p) => relative(RAIZ, p).split(sep).join("/"))
    .filter((r) => !r.startsWith("app/admin/") && r !== "app/lib/plataforma.ts")
    .filter((r) => IMPORTA_PLATAFORMA.test(readFileSync(join(RAIZ, r), "utf8")));
  expect(proibidos).toEqual([]);
});

test("a varredura reconhece as formas de import", () => {
  expect(IMPORTA_PLATAFORMA.test('import { x } from "@/app/lib/plataforma";')).toBe(true);
  expect(IMPORTA_PLATAFORMA.test("import { x } from './plataforma'")).toBe(true);
  expect(IMPORTA_PLATAFORMA.test('export * from "../lib/plataforma.ts"')).toBe(true);
  expect(IMPORTA_PLATAFORMA.test('await import("@/app/lib/plataforma")')).toBe(true);
  expect(IMPORTA_PLATAFORMA.test('import { x } from "@/app/lib/arenas-publicas";')).toBe(false);
});

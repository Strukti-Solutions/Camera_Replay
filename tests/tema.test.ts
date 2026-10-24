import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { cookieDoTema, lerTema, proximoTema, raioAteOsCantos } from "../app/componentes/tema";

test("lerTema só aceita claro e escuro", () => {
  expect(lerTema("claro")).toBe("claro");
  expect(lerTema("escuro")).toBe("escuro");
  expect(lerTema(undefined)).toBeNull();
  expect(lerTema("")).toBeNull();
  expect(lerTema("azul")).toBeNull();
  expect(lerTema("ESCURO")).toBeNull();
});

test("proximoTema alterna", () => {
  expect(proximoTema("claro")).toBe("escuro");
  expect(proximoTema("escuro")).toBe("claro");
});

test("cookieDoTema dura um ano e vale no site todo", () => {
  expect(cookieDoTema("escuro")).toBe("tema=escuro; Path=/; Max-Age=31536000; SameSite=Lax");
});

const css = readFileSync("app/globals.css", "utf8").replaceAll(String.fromCharCode(13), "");
const contar = (t: string) => css.split(t).length - 1;

test("cada bloco escuro do media tem o espelho em data-tema=escuro", () => {
  const medias = contar("@media (prefers-color-scheme: dark)");
  expect(medias).toBeGreaterThan(0);
  expect(contar(':root[data-tema="escuro"] {')).toBe(medias);
});

test("o media escuro não vale quando o tema escolhido é claro", () => {
  const blocos = css.split("@media (prefers-color-scheme: dark)").slice(1);
  for (const b of blocos) {
    const dentro = b.slice(0, b.indexOf("\n}\n"));
    expect(dentro).toContain(':root:not([data-tema="claro"]) {');
    expect(dentro).not.toMatch(/:root \{/);
  }
});

test("color-scheme acompanha a escolha", () => {
  expect(css).toMatch(/:root\[data-tema="claro"\][^{]*\{[^}]*color-scheme: light;/);
  expect(css).toMatch(/:root\[data-tema="escuro"\][^{]*\{[^}]*color-scheme: dark;/);
});

test("raioAteOsCantos alcança o canto mais distante do ponto", () => {
  expect(raioAteOsCantos(0, 0, 300, 400)).toBe(500);
  expect(raioAteOsCantos(300, 400, 300, 400)).toBe(500);
  expect(raioAteOsCantos(150, 200, 300, 400)).toBe(250);
});

test("atributo hidden sempre esconde, mesmo em elementos com display próprio", () => {
  expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test("a troca de tema animada respeita quem pede menos movimento", () => {
  expect(css).toContain("::view-transition-new(root)");
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^@]*view-transition/);
});

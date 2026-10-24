import { expect, test } from "vitest";
import { linksDoCabecalhoPublico } from "../app/componentes/topo-links";

test("logado: buscar, minhas reservas e minha conta, nessa ordem", () => {
  expect(linksDoCabecalhoPublico(true, null)).toEqual([
    { href: "/", texto: "Buscar quadras" },
    { href: "/minhas-reservas", texto: "Minhas reservas" },
    { href: "/minha-conta", texto: "Minha conta" },
  ]);
});

test("deslogado sem voltar: entrar e criar conta", () => {
  expect(linksDoCabecalhoPublico(false, null)).toEqual([
    { href: "/entrar", texto: "Entrar" },
    { href: "/criar-conta", texto: "Criar conta" },
  ]);
});

test("deslogado com voltar: o caminho vai codificado nos dois links", () => {
  const v = "%2Fa%2Fabc%3Fquadra%3D1%26dia%3D2026-10-26";
  expect(linksDoCabecalhoPublico(false, "/a/abc?quadra=1&dia=2026-10-26")).toEqual([
    { href: `/entrar?voltar=${v}`, texto: "Entrar" },
    { href: `/criar-conta?voltar=${v}`, texto: "Criar conta" },
  ]);
});

test("logado ignora o voltar", () => {
  expect(linksDoCabecalhoPublico(true, "/a/x").map((l) => l.href)).toEqual(["/", "/minhas-reservas", "/minha-conta"]);
});

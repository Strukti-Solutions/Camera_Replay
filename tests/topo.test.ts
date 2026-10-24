import { expect, test } from "vitest";
import { linksDoCabecalhoPublico } from "../app/componentes/topo-links";

test("logado: buscar e minhas reservas como botões, minha conta só com o ícone", () => {
  expect(linksDoCabecalhoPublico(true, null)).toEqual([
    { href: "/", texto: "Buscar quadras", curto: "Buscar", icone: "buscar", estilo: "botao" },
    { href: "/minhas-reservas", texto: "Minhas reservas", curto: "Reservas", icone: "reservas", estilo: "botao" },
    { href: "/minha-conta", texto: "Minha conta", icone: "conta", estilo: "icone" },
  ]);
});

test("deslogado sem voltar: entrar e criar conta (criar conta em destaque)", () => {
  expect(linksDoCabecalhoPublico(false, null)).toEqual([
    { href: "/entrar", texto: "Entrar", estilo: "botao" },
    { href: "/criar-conta", texto: "Criar conta", estilo: "destaque" },
  ]);
});

test("deslogado com voltar: o caminho vai codificado nos dois links", () => {
  const v = "%2Fa%2Fabc%3Fquadra%3D1%26dia%3D2026-10-26";
  expect(linksDoCabecalhoPublico(false, "/a/abc?quadra=1&dia=2026-10-26").map((l) => l.href)).toEqual([
    `/entrar?voltar=${v}`,
    `/criar-conta?voltar=${v}`,
  ]);
});

test("logado ignora o voltar", () => {
  expect(linksDoCabecalhoPublico(true, "/a/x").map((l) => l.href)).toEqual(["/", "/minhas-reservas", "/minha-conta"]);
});

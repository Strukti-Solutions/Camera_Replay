import { afterEach, expect, test, vi } from "vitest";
import { ERRO_SENHA_LONGA, lerTaxa, textoTaxa, mensagemErroAdmin, nomeDaArena, senhaLongaDemais, textoStatusArena } from "../app/admin/apresentacao";

afterEach(() => vi.restoreAllMocks());

test("nome da arena: apara espaços e aceita de 1 a 80 caracteres", () => {
  expect(nomeDaArena("  Arena Beira Mar  ")).toBe("Arena Beira Mar");
  expect(nomeDaArena("a".repeat(80))).toBe("a".repeat(80));
  expect(nomeDaArena("")).toBeNull();
  expect(nomeDaArena("   ")).toBeNull();
  expect(nomeDaArena("a".repeat(81))).toBeNull();
});

test("senha: até 200 caracteres passa; acima disso é recusada", () => {
  expect(senhaLongaDemais("a".repeat(200))).toBe(false);
  expect(senhaLongaDemais("a".repeat(201))).toBe(true);
  expect(ERRO_SENHA_LONGA).toBe("Senha longa demais (máximo 200 caracteres).");
});

test("status da arena na tabela", () => {
  expect(textoStatusArena("ativa")).toBe("Ativa");
  expect(textoStatusArena("suspensa")).toBe("Suspensa");
});

test("erros conhecidos de plataforma viram texto para a equipe, sem log", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(mensagemErroAdmin(new Error("e-mail já cadastrado"), "x")).toBe("E-mail já cadastrado.");
  expect(mensagemErroAdmin(new Error("e-mail inválido"), "x")).toBe("E-mail inválido.");
  expect(mensagemErroAdmin(new Error("senha curta: mínimo 12 caracteres"), "x")).toBe(
    "Senha curta: mínimo de 12 caracteres.",
  );
  expect(mensagemErroAdmin(new Error("senha curta: mínimo 10 caracteres"), "x")).toBe(
    "Senha curta: mínimo de 10 caracteres.",
  );
  expect(log).not.toHaveBeenCalled();
});

test("outro erro vira genérico e loga só contexto, nome, código e mensagem", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const e = Object.assign(new Error("duplicate key"), { code: "23505", detail: "Key (email)=(dono@x.com)" });
  expect(mensagemErroAdmin(e, "criar arena")).toBe("Algo deu errado. Tente de novo.");
  expect(log).toHaveBeenCalledTimes(1);
  const linha = log.mock.calls[0].map(String).join(" ");
  expect(linha).toContain("criar arena");
  expect(linha).toContain("23505");
  expect(linha).not.toContain("dono@x.com");
});

test("valor lançado que não é Error vira genérico sem eco", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(mensagemErroAdmin("senha-secreta", "criar super admin")).toBe("Algo deu errado. Tente de novo.");
  expect(log.mock.calls[0].map(String).join(" ")).not.toContain("senha-secreta");
});

test("lerTaxa aceita vírgula ou ponto e recusa lixo", () => {
  expect(lerTaxa("10")).toBe(10);
  expect(lerTaxa(" 7,5 ")).toBe(7.5);
  expect(lerTaxa("7,55")).toBe(7.55);
  expect(lerTaxa("7.5")).toBe(7.5);
  expect(lerTaxa("0")).toBe(0);
  for (const ruim of ["", "  ", "abc", "7,5,1", "1e1", "-1", "7,", ",5", "0x10", "Infinity"]) {
    expect(lerTaxa(ruim)).toBeNull();
  }
});

test("textoTaxa mostra vírgula e corta zeros", () => {
  expect(textoTaxa(5)).toBe("5%");
  expect(textoTaxa(7.5)).toBe("7,5%");
  expect(textoTaxa(7.55)).toBe("7,55%");
  expect(textoTaxa(0)).toBe("0%");
});

import { expect, test } from "vitest";
import { MENSAGEM_ARENA_SUSPENSA, mensagemDeEntrar } from "../app/entrar/mensagens";

test("cada motivo de recusa do login vira a sua frase", () => {
  expect(mensagemDeEntrar("credenciais")).toBe("E-mail ou senha incorretos.");
  expect(mensagemDeEntrar("suspensa")).toBe("Esta arena está suspensa. Fale com a Strukti.");
  expect(MENSAGEM_ARENA_SUSPENSA).toBe("Esta arena está suspensa. Fale com a Strukti.");
});

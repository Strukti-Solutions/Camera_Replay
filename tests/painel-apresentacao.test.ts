import { afterEach, expect, test, vi } from "vitest";
import { ErroPainel } from "../app/lib/painel";
import { mensagemDoErro, textoCamera, textoVistoHa } from "../app/painel/apresentacao";

afterEach(() => vi.restoreAllMocks());

const agora = new Date("2026-10-17T20:00:00Z");
const antes = (seg: number) => new Date(agora.getTime() - seg * 1000);

test("status da câmera na lista", () => {
  expect(textoCamera(null)).toBe("Sem câmera");
  expect(textoCamera({ online: true })).toBe("Online");
  expect(textoCamera({ online: false })).toBe("Offline");
});

test("visto há: menos de 1 min, minutos, horas e dias", () => {
  expect(textoVistoHa(null, agora)).toBe("nunca conectou");
  expect(textoVistoHa(antes(20), agora)).toBe("visto há menos de 1 min");
  expect(textoVistoHa(antes(60), agora)).toBe("visto há 1 min");
  expect(textoVistoHa(antes(59 * 60 + 59), agora)).toBe("visto há 59 min");
  expect(textoVistoHa(antes(3 * 3600 + 10), agora)).toBe("visto há 3 h");
  // Mais de um dia: data e hora em São Paulo.
  expect(textoVistoHa(new Date("2026-10-15T12:10:00Z"), agora)).toBe("visto em 15/10, 09:10");
});

test("relógio adiantado (visto no futuro) conta como agora", () => {
  expect(textoVistoHa(antes(-30), agora)).toBe("visto há menos de 1 min");
});

test("ErroPainel vira frase com maiúscula e ponto, sem log", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(mensagemDoErro(new ErroPainel("quadra já tem câmera"), "x")).toBe("Quadra já tem câmera.");
  expect(log).not.toHaveBeenCalled();
});

test("outro erro vira mensagem genérica e loga só nome, código e mensagem", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const e = Object.assign(new Error("null value in column"), {
    code: "23502",
    detail: "Failing row contains (senha-secreta)",
  });
  expect(mensagemDoErro(e, "cadastrar câmera")).toBe("Algo deu errado. Tente de novo.");
  expect(log).toHaveBeenCalledTimes(1);
  const linha = log.mock.calls[0].map(String).join(" ");
  expect(linha).toContain("cadastrar câmera");
  expect(linha).toContain("23502");
  expect(linha).not.toContain("senha-secreta");
});

test("valor lançado que não é Error também vira genérico sem eco", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(mensagemDoErro("token-xyz", "criar botão")).toBe("Algo deu errado. Tente de novo.");
  expect(log.mock.calls[0].map(String).join(" ")).not.toContain("token-xyz");
});

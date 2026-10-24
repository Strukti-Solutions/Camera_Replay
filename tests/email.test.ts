import { afterEach, expect, test, vi } from "vitest";
import { criarEnvioEmail, envioEmailConfigurado } from "../app/lib/email";

const MSG = { para: "a@b.com", assunto: "Assunto", texto: "Texto com link https://x/redefinir-senha?t=abc" };
const CHAVE = "re_chave_secreta_123";

afterEach(() => vi.restoreAllMocks());

test("com chave e remetente, envia pelo Resend", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
  const enviar = criarEnvioEmail({ RESEND_API_KEY: CHAVE, EMAIL_REMETENTE: "Replay <nao-responda@x.com>" }, fetcher);
  await enviar(MSG);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(init.method).toBe("POST");
  expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${CHAVE}`);
  expect(JSON.parse(String(init.body))).toEqual({
    from: "Replay <nao-responda@x.com>", to: ["a@b.com"], subject: "Assunto", text: MSG.texto,
  });
});

test("resposta 500 rejeita sem mostrar a chave", async () => {
  const fetcher = vi.fn(async () => new Response("erro", { status: 500 }));
  const enviar = criarEnvioEmail({ RESEND_API_KEY: CHAVE, EMAIL_REMETENTE: "r@x.com" }, fetcher);
  const erro = await enviar(MSG).then(() => null, (e: unknown) => e);
  expect(erro).toBeInstanceOf(Error);
  expect((erro as Error).message).not.toContain(CHAVE);
  expect((erro as Error).message).not.toContain(MSG.para);
});

test("sem configuração em produção não chama o fetcher nem mostra o texto", async () => {
  const fetcher = vi.fn(async () => new Response("{}"));
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  await criarEnvioEmail({ NODE_ENV: "production" }, fetcher)(MSG);
  expect(fetcher).not.toHaveBeenCalled();
  expect(info).not.toHaveBeenCalled();
  expect(erro).toHaveBeenCalledWith("e-mail: envio não configurado");
});

test("sem configuração fora de produção mostra o texto no terminal", async () => {
  const fetcher = vi.fn(async () => new Response("{}"));
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  await criarEnvioEmail({ NODE_ENV: "development", EMAIL_REMETENTE: "r@x.com" }, fetcher)(MSG);
  expect(fetcher).not.toHaveBeenCalled();
  expect(info.mock.calls.flat().join(" ")).toContain(MSG.texto);
});

test("envioEmailConfigurado: em produção exige chave e remetente; fora de produção sempre", () => {
  expect(envioEmailConfigurado({ NODE_ENV: "production" })).toBe(false);
  expect(envioEmailConfigurado({ NODE_ENV: "production", RESEND_API_KEY: CHAVE })).toBe(false);
  expect(envioEmailConfigurado({ NODE_ENV: "production", EMAIL_REMETENTE: "r@x.com" })).toBe(false);
  expect(envioEmailConfigurado({ NODE_ENV: "production", RESEND_API_KEY: " ", EMAIL_REMETENTE: "r@x.com" })).toBe(false);
  expect(envioEmailConfigurado({ NODE_ENV: "production", RESEND_API_KEY: CHAVE, EMAIL_REMETENTE: "r@x.com" })).toBe(true);
  expect(envioEmailConfigurado({ NODE_ENV: "development" })).toBe(true);
  expect(envioEmailConfigurado({})).toBe(true);
});

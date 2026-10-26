import { afterEach, expect, test, vi } from "vitest";
import { criarEnvioEmail, envioEmailConfigurado, type Transporte } from "../app/lib/email";

const MSG = { para: "a@b.com", assunto: "Assunto", texto: "Texto com link https://x/redefinir-senha?t=abc" };
const SENHA = "senha-de-app-secreta";
const SMTP = { SMTP_USUARIO: "replay@gmail.com", SMTP_SENHA: SENHA };

afterEach(() => vi.restoreAllMocks());

function transporteFalso(falha?: Error) {
  const enviados: Parameters<Transporte["sendMail"]>[0][] = [];
  const configs: unknown[] = [];
  const criar = (config: unknown): Transporte => {
    configs.push(config);
    return {
      sendMail: async (m) => {
        if (falha) throw falha;
        enviados.push(m);
        return {};
      },
    };
  };
  return { criar, enviados, configs };
}

test("com usuário e senha, envia pelo SMTP do Gmail com o destinatário separado", async () => {
  const t = transporteFalso();
  await criarEnvioEmail(SMTP, t.criar)(MSG);
  expect(t.configs).toEqual([
    { host: "smtp.gmail.com", port: 465, secure: true, auth: { user: "replay@gmail.com", pass: SENHA } },
  ]);
  expect(t.enviados).toEqual([
    {
      from: { name: "Replay", address: "replay@gmail.com" },
      to: { name: "", address: "a@b.com" },
      subject: "Assunto",
      text: MSG.texto,
    },
  ]);
});

test("assunto com quebra de linha não vira cabeçalho", async () => {
  const t = transporteFalso();
  await criarEnvioEmail(SMTP, t.criar)({ ...MSG, assunto: "Oi\r\nBcc: x@y.com" });
  expect(t.enviados[0].subject).toBe("Oi Bcc: x@y.com");
});

test("falha do SMTP rejeita sem mostrar senha, destinatário nem texto", async () => {
  const t = transporteFalso(new Error(`535 auth failed for replay@gmail.com ${SENHA} a@b.com`));
  const erro = await criarEnvioEmail(SMTP, t.criar)(MSG).then(() => null, (e: unknown) => e);
  expect(erro).toBeInstanceOf(Error);
  const msg = (erro as Error).message;
  expect(msg).not.toContain(SENHA);
  expect(msg).not.toContain(MSG.para);
  expect(msg).not.toContain("redefinir");
});

test("sem configuração em produção não cria transporte nem mostra o texto", async () => {
  const t = transporteFalso();
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  await criarEnvioEmail({ NODE_ENV: "production" }, t.criar)(MSG);
  expect(t.configs).toEqual([]);
  expect(info).not.toHaveBeenCalled();
  expect(erro).toHaveBeenCalledWith("e-mail: envio não configurado");
});

test("sem configuração fora de produção mostra o texto no terminal", async () => {
  const t = transporteFalso();
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  await criarEnvioEmail({ NODE_ENV: "development" }, t.criar)(MSG);
  expect(t.configs).toEqual([]);
  expect(info.mock.calls.flat().join(" ")).toContain(MSG.texto);
});

test("envioEmailConfigurado: em produção exige usuário e senha; fora de produção sempre", () => {
  expect(envioEmailConfigurado({ NODE_ENV: "production" })).toBe(false);
  expect(envioEmailConfigurado({ NODE_ENV: "production", SMTP_USUARIO: "r@x.com" })).toBe(false);
  expect(envioEmailConfigurado({ NODE_ENV: "production", SMTP_SENHA: SENHA })).toBe(false);
  expect(envioEmailConfigurado({ NODE_ENV: "production", SMTP_USUARIO: " ", SMTP_SENHA: SENHA })).toBe(false);
  expect(envioEmailConfigurado({ NODE_ENV: "production", ...SMTP })).toBe(true);
  expect(envioEmailConfigurado({ NODE_ENV: "development" })).toBe(true);
  expect(envioEmailConfigurado({})).toBe(true);
});

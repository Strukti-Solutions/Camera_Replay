import { createTransport } from "nodemailer";

// Envio de e-mail transacional pelo SMTP do Gmail (conta da Strukti, senha de
// app). Usuário e senha ficam só nas variáveis de ambiente e nunca aparecem em
// erro nem em log. Spec: docs/superpowers/specs/2026-10-25-emails-design.md.

export type MensagemEmail = { para: string; assunto: string; texto: string };
export type EnviarEmail = (m: MensagemEmail) => Promise<void>;

type Ambiente = Record<string, string | undefined>;
type Endereco = { name: string; address: string };

// O pedaço do nodemailer que usamos (o teste troca por um falso).
export type Transporte = {
  sendMail: (m: { from: Endereco; to: Endereco; subject: string; text: string }) => Promise<unknown>;
};
type CriarTransporte = (config: {
  host: string; port: number; secure: boolean; auth: { user: string; pass: string };
}) => Transporte;

const criarNodemailer: CriarTransporte = (config) => createTransport(config);

function credenciais(env: Ambiente): { user: string; pass: string } | null {
  const user = env.SMTP_USUARIO?.trim();
  const pass = env.SMTP_SENHA?.trim();
  return user && pass ? { user, pass } : null;
}

// Em produção o envio só existe com usuário e senha; sem eles a tela de entrar
// esconde o "Esqueci a senha". Fora de produção vale sempre: o e-mail aparece
// no terminal do next dev.
export function envioEmailConfigurado(env: Ambiente = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  return credenciais(env) !== null;
}

export function criarEnvioEmail(env: Ambiente = process.env, criar: CriarTransporte = criarNodemailer): EnviarEmail {
  const auth = credenciais(env);
  if (!auth) {
    return async (m) => {
      if (env.NODE_ENV === "production") {
        // Sem o texto: ele pode ter um link de redefinir senha.
        console.error("e-mail: envio não configurado");
        return;
      }
      // Prévia/dev: o e-mail aparece no terminal do next dev.
      console.info(`e-mail (envio não configurado) para ${m.para}: ${m.assunto}\n${m.texto}`);
    };
  }
  let transporte: Transporte | null = null;
  return async (m) => {
    transporte ??= criar({ host: "smtp.gmail.com", port: 465, secure: true, auth });
    try {
      await transporte.sendMail({
        from: { name: "Replay", address: auth.user },
        // Endereço já separado: o nodemailer não precisa interpretar o texto do e-mail.
        to: { name: "", address: m.para },
        // Quebra de linha no assunto nunca vira cabeçalho novo.
        subject: m.assunto.replace(/[\r\n]+/g, " "),
        text: m.texto,
      });
    } catch (e) {
      // Só o código SMTP (ex.: 535), nunca a mensagem: ela pode citar usuário ou destinatário.
      const codigo = (e as { responseCode?: unknown })?.responseCode;
      throw new Error(`e-mail: o envio pelo SMTP falhou${typeof codigo === "number" ? ` (${codigo})` : ""}`);
    }
  };
}

// Envio de e-mail transacional pelo Resend. A chave fica só nas variáveis de
// ambiente e nunca aparece em erro nem em log.

export type MensagemEmail = { para: string; assunto: string; texto: string };
export type EnviarEmail = (m: MensagemEmail) => Promise<void>;

type Ambiente = Record<string, string | undefined>;
type Buscar = (url: string, init: RequestInit) => Promise<Response>;

const URL_RESEND = "https://api.resend.com/emails";

export function criarEnvioEmail(env: Ambiente = process.env, fetcher: Buscar = fetch): EnviarEmail {
  const chave = env.RESEND_API_KEY?.trim();
  const remetente = env.EMAIL_REMETENTE?.trim();
  if (!chave || !remetente) {
    return async (m) => {
      if (env.NODE_ENV === "production") {
        // Sem o texto: ele pode ter um link de redefinir senha.
        console.error("e-mail: envio não configurado");
        return;
      }
      // Prévia/dev: o link aparece no terminal do next dev.
      console.info(`e-mail (envio não configurado) para ${m.para}: ${m.assunto}\n${m.texto}`);
    };
  }
  return async (m) => {
    const r = await fetcher(URL_RESEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: remetente, to: [m.para], subject: m.assunto, text: m.texto }),
    });
    if (!r.ok) throw new Error(`e-mail: o Resend respondeu ${r.status}`);
  };
}

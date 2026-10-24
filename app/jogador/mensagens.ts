// Frases das telas do jogador (criar conta e minha conta).

export const MENSAGEM_MUITAS_TENTATIVAS = "Muitas tentativas. Espere 15 minutos e tente de novo.";

export type ErroCriarConta = "nome" | "email" | "senha" | "termos" | "email_em_uso";
export type ErroMinhaConta = "nome" | "senha" | "senha_atual";

export function mensagemCriarConta(erro: ErroCriarConta): string {
  switch (erro) {
    case "nome": return "Informe seu nome (até 80 caracteres).";
    case "email": return "Informe um e-mail válido.";
    case "senha": return "A senha precisa ter pelo menos 8 caracteres.";
    case "termos": return "Para criar a conta, aceite os termos de uso e a política de privacidade.";
    case "email_em_uso": return 'Este e-mail já tem conta. Entre ou use "Esqueci a senha".';
  }
}

export function mensagemMinhaConta(erro: ErroMinhaConta): string {
  switch (erro) {
    case "nome": return "Informe seu nome (até 80 caracteres).";
    case "senha": return "A senha precisa ter pelo menos 8 caracteres.";
    case "senha_atual": return "Senha atual incorreta.";
  }
}

export const MSG_NAO_CANCELOU = "Não foi possível cancelar. O prazo é até 24 h antes do início.";

// Recusas ao apagar a conta (senha errada, limite de tentativas, reserva futura).
export function mensagemApagarConta(erro: "senha" | "reservas_futuras" | "limite"): string {
  switch (erro) {
    case "reservas_futuras": return "Cancele suas reservas futuras antes de apagar a conta.";
    case "limite": return MENSAGEM_MUITAS_TENTATIVAS;
    case "senha": return "Senha incorreta.";
  }
}

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

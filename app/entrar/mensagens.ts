// Frases das recusas de login, as mesmas para dono e aluno. "suspensa" só chega
// depois da senha certa (sessao.ts e acesso-aluno.ts), então não revela nada a
// quem não tem a conta.

export type MotivoRecusa = "credenciais" | "bloqueado" | "suspensa";

export const MENSAGEM_ARENA_SUSPENSA = "Esta arena está suspensa. Fale com a Strukti.";

export function mensagemDeEntrar(motivo: MotivoRecusa): string {
  if (motivo === "bloqueado") return "Muitas tentativas. Espere 15 minutos e tente de novo.";
  if (motivo === "suspensa") return MENSAGEM_ARENA_SUSPENSA;
  return "E-mail ou senha incorretos.";
}

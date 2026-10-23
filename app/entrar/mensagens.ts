// Frases das recusas do login único. "suspensa" só chega ao dono e só
// depois da senha certa (entrar-unico.ts), então não revela nada a
// quem não tem a conta.

// Não existe recusa "bloqueado": o login responde "credenciais" também quando o
// limite de tentativas estoura, para não revelar o tipo da conta (entrar-unico.ts).
export type MotivoRecusa = "credenciais" | "suspensa";

export const MENSAGEM_ARENA_SUSPENSA = "Esta arena está suspensa. Fale com a Strukti.";

export function mensagemDeEntrar(motivo: MotivoRecusa): string {
  if (motivo === "suspensa") return MENSAGEM_ARENA_SUSPENSA;
  return "E-mail ou senha incorretos.";
}

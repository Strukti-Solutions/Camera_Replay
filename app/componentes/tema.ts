// Regras puras do tema. O cookie guarda só a escolha explícita da pessoa;
// sem cookie, vale o tema do aparelho (prefers-color-scheme).
export type Tema = "claro" | "escuro";

export function lerTema(valor: string | undefined): Tema | null {
  return valor === "claro" || valor === "escuro" ? valor : null;
}

export function proximoTema(atual: Tema): Tema {
  return atual === "claro" ? "escuro" : "claro";
}

export function cookieDoTema(tema: Tema): string {
  return `tema=${tema}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

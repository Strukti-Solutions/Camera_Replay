export type LinkDoTopo = { href: string; texto: string };

// Links do cabeçalho público. `voltar` já chega validado (caminhoSeguro): só
// precisa ir codificado na query.
export function linksDoCabecalhoPublico(logado: boolean, voltar: string | null): LinkDoTopo[] {
  if (logado) {
    return [
      { href: "/", texto: "Buscar quadras" },
      { href: "/minhas-reservas", texto: "Minhas reservas" },
      { href: "/minha-conta", texto: "Minha conta" },
    ];
  }
  const query = voltar ? `?voltar=${encodeURIComponent(voltar)}` : "";
  return [
    { href: `/entrar${query}`, texto: "Entrar" },
    { href: `/criar-conta${query}`, texto: "Criar conta" },
  ];
}

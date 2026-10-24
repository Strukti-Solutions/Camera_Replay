export type IconeDoTopo = "buscar" | "reservas" | "conta";

// `estilo`: "botao" (contorno), "destaque" (cheio) ou "icone" (só o ícone,
// com `texto` como nome acessível). `curto` é o texto no celular estreito.
export type LinkDoTopo = {
  href: string;
  texto: string;
  curto?: string;
  icone?: IconeDoTopo;
  estilo: "botao" | "destaque" | "icone";
};

// Links do cabeçalho público. `voltar` já chega validado (caminhoSeguro): só
// precisa ir codificado na query.
export function linksDoCabecalhoPublico(logado: boolean, voltar: string | null): LinkDoTopo[] {
  if (logado) {
    return [
      { href: "/", texto: "Buscar quadras", curto: "Buscar", icone: "buscar", estilo: "botao" },
      { href: "/minhas-reservas", texto: "Minhas reservas", curto: "Reservas", icone: "reservas", estilo: "botao" },
      { href: "/minha-conta", texto: "Minha conta", icone: "conta", estilo: "icone" },
    ];
  }
  const query = voltar ? `?voltar=${encodeURIComponent(voltar)}` : "";
  return [
    { href: `/entrar${query}`, texto: "Entrar", estilo: "botao" },
    { href: `/criar-conta${query}`, texto: "Criar conta", estilo: "destaque" },
  ];
}

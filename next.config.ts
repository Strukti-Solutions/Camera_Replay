import type { NextConfig } from "next";

const config: NextConfig = {
  // Cabeçalhos de segurança em todas as rotas. no-referrer evita que a URL
  // da quadra (/q/<slug>, que é a própria credencial de acesso) vaze para
  // terceiros, inclusive para o R2 ao carregar o vídeo.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;

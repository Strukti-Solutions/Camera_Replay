import type { NextConfig } from "next";

const config: NextConfig = {
  // Cabeçalhos de segurança em todas as rotas. no-referrer evita que a URL
  // da área do aluno (/a/<slug>, com o slug da arena e o id da reserva) vaze
  // para terceiros, inclusive para o R2 ao carregar o vídeo.
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

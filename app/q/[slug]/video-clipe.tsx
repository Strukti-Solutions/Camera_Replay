"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

// Player do lance. A URL assinada vale 15 min: se o jogador deixou a página
// aberta e o vídeo falha ao carregar, pede ao servidor uma lista nova (com
// URLs novas), uma única vez para não entrar em laço se o erro for outro.
export function VideoClipe({ url, rotulo }: { url: string; rotulo: string }) {
  const router = useRouter();
  const jaAtualizou = useRef(false);

  return (
    <video
      controls
      playsInline
      preload="none"
      src={url}
      aria-label={rotulo}
      onError={() => {
        if (jaAtualizou.current) return;
        jaAtualizou.current = true;
        router.refresh();
      }}
    />
  );
}

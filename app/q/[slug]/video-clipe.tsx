"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Player do lance. A URL assinada vale 15 min: se o jogador deixou a página
// aberta e o vídeo falha ao carregar, pede ao servidor uma lista nova (com
// URLs novas). A trava impede laço se o erro não for de expiração; ela só é
// liberada quando o vídeo carrega de fato (não quando a URL muda, porque toda
// atualização gera assinatura nova e reabriria o laço). Assim cada expiração
// seguinte do mesmo lance também é recuperada.
export function VideoClipe({ url, rotulo }: { url: string; rotulo: string }) {
  const router = useRouter();
  const jaAtualizou = useRef(false);
  const [falhou, setFalhou] = useState(false);

  return (
    <>
      <video
        controls
        playsInline
        preload="none"
        src={url}
        aria-label={rotulo}
        onLoadedData={() => {
          jaAtualizou.current = false;
          setFalhou(false);
        }}
        onError={() => {
          if (jaAtualizou.current) {
            setFalhou(true);
            return;
          }
          jaAtualizou.current = true;
          router.refresh();
        }}
      />
      <p className="lance-erro" role="status">
        {falhou ? "Não carregou. Toque em Atualizar lista." : ""}
      </p>
    </>
  );
}

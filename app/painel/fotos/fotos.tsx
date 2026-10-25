"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Confirmar } from "@/app/painel/quadras/[id]/formularios";
import { apagarFotoAction, capaFotoAction, enviarFotosAction, moverFotoAction, type EstadoFotos } from "./actions";
import { reduzirFoto } from "./reduzir";

type Props = {
  quadraId: string | null; // null = fotos da arena
  fotos: { id: string }[];
  max: number;
  armazenamento: boolean; // R2 configurado
  rotulo: string; // "da arena" ou "da quadra"
};

const INICIAL: EstadoFotos = { erro: null, enviadas: 0, versao: 0 };

// Fotos do dono: grade com capa, mover, usar como capa e apagar; envio com a
// foto reduzida no navegador. Sem JavaScript, o formulário envia o arquivo original.
export function FotosDoDono({ quadraId, fotos, max, armazenamento, rotulo }: Props) {
  const [estado, acaoForm, pendenteForm] = useActionState(enviarFotosAction, INICIAL);
  const [montado, setMontado] = useState(false);
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<{ erro: string | null; enviadas: number } | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => setMontado(true), []);
  useEffect(() => {
    if (estado.versao > 0) setResultado({ erro: estado.erro, enviadas: estado.enviadas });
  }, [estado]);

  const cheio = fotos.length >= max;
  const enviando = progresso !== null || pendenteForm;

  // Com JavaScript: uma foto por vez, já reduzida, para mostrar o progresso.
  async function enviarEscolhidas(arquivos: File[]) {
    const vagas = Math.max(0, max - fotos.length);
    const lote = arquivos.slice(0, vagas);
    let enviadas = 0;
    let erro: string | null = arquivos.length > vagas ? `Só cabem mais ${vagas} ${vagas === 1 ? "foto" : "fotos"}.` : null;
    let versao = 0;
    for (const [i, arquivo] of lote.entries()) {
      setProgresso({ atual: i + 1, total: lote.length });
      const reduzida = await reduzirFoto(arquivo);
      const form = new FormData();
      form.set("quadraId", quadraId ?? "");
      form.set("foto", reduzida, arquivo.name);
      const r = await enviarFotosAction({ ...INICIAL, versao: versao++ }, form);
      if (r.erro) {
        erro = r.erro;
        break;
      }
      enviadas++;
    }
    setProgresso(null);
    setResultado({ erro, enviadas });
    if (campo.current) campo.current.value = "";
  }

  return (
    <div className="ft">
      <p className="ft-contador">
        {fotos.length} de {max} fotos
        {fotos.length > 0 && " · a primeira é a capa"}
      </p>
      {fotos.length > 0 && (
        <ul className="ft-grade">
          {fotos.map((f, i) => (
            <li key={f.id} className="ft-item">
              <div className="ft-moldura">
                {/* eslint-disable-next-line @next/next/no-img-element -- rota própria, já com cache */}
                <img src={`/fotos/${f.id}`} alt={`Foto ${i + 1} ${rotulo}`} loading="lazy" />
                {i === 0 && <span className="ft-capa">Capa</span>}
              </div>
              <div className="ft-acoes">
                <form action={moverFotoAction}>
                  <input type="hidden" name="fotoId" value={f.id} />
                  <input type="hidden" name="direcao" value="-1" />
                  <button type="submit" className="botao ft-seta" disabled={i === 0} aria-label={`Mover foto ${i + 1} para a esquerda`}>
                    ‹
                  </button>
                </form>
                <form action={moverFotoAction}>
                  <input type="hidden" name="fotoId" value={f.id} />
                  <input type="hidden" name="direcao" value="1" />
                  <button
                    type="submit"
                    className="botao ft-seta"
                    disabled={i === fotos.length - 1}
                    aria-label={`Mover foto ${i + 1} para a direita`}
                  >
                    ›
                  </button>
                </form>
                {i > 0 && (
                  <form action={capaFotoAction}>
                    <input type="hidden" name="fotoId" value={f.id} />
                    <button type="submit" className="botao" aria-label={`Usar foto ${i + 1} como capa`}>
                      Capa
                    </button>
                  </form>
                )}
                {armazenamento && (
                  <Confirmar
                    acao={apagarFotoAction}
                    campo="fotoId"
                    valor={f.id}
                    rotulo="Apagar"
                    pergunta={`Apagar a foto ${i + 1}? Não dá para desfazer.`}
                    confirmar="Sim, apagar foto"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!armazenamento ? (
        <p className="suave" role="status">
          Armazenamento de fotos não configurado.
        </p>
      ) : cheio ? (
        <p className="suave">Limite de fotos atingido.</p>
      ) : (
        <form
          action={acaoForm}
          className="ft-envio"
          onSubmit={(e) => {
            e.preventDefault();
            const arquivos = [...(campo.current?.files ?? [])];
            if (arquivos.length > 0 && !enviando) void enviarEscolhidas(arquivos);
          }}
        >
          <input type="hidden" name="quadraId" value={quadraId ?? ""} />
          <label className="botao botao-cheio ft-escolher">
            {enviando ? "Enviando…" : "Adicionar fotos"}
            <input
              ref={campo}
              className="ft-arquivo"
              type="file"
              name="foto"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={enviando}
              onChange={(e) => {
                if (montado) e.currentTarget.form?.requestSubmit();
              }}
            />
          </label>
          {/* Sem JavaScript, o envio é por este botão. */}
          <button type="submit" className="botao" hidden={montado}>
            Enviar
          </button>
          <span className="suave">JPEG, PNG ou WebP, até 2 MB.</span>
        </form>
      )}

      <p className="ft-status" role="status" aria-live="polite">
        {progresso
          ? `Enviando ${progresso.atual} de ${progresso.total}…`
          : resultado && !resultado.erro && resultado.enviadas > 0
            ? resultado.enviadas === 1
              ? "Foto enviada."
              : `${resultado.enviadas} fotos enviadas.`
            : null}
      </p>
      {resultado?.erro && (
        <p className="erro-form" role="alert">
          {resultado.enviadas > 0 && `${resultado.enviadas} enviada${resultado.enviadas === 1 ? "" : "s"}. `}
          {resultado.erro}
        </p>
      )}
    </div>
  );
}

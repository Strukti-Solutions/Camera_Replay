import type { Metadata } from "next";
import Link from "next/link";
import { listarQuadras } from "@/app/lib/painel";
import { poolCompartilhado } from "@/app/lib/pool";
import { textoCamera } from "./apresentacao";
import { FormularioNovaQuadra } from "./nova-quadra";
import { exigirSessao } from "./sessao-atual";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quadras",
  robots: { index: false, follow: false },
};

export default async function PaginaPainel() {
  // A página confere a sessão por conta própria: o layout não roda de novo
  // em toda navegação do cliente.
  const sessao = await exigirSessao();
  const quadras = await listarQuadras(poolCompartilhado(), sessao.arenaId);

  return (
    <main className="miolo painel">
      <h1>Quadras</h1>

      {quadras.length === 0 ? (
        <p className="painel-vazio">Nenhuma quadra cadastrada.</p>
      ) : (
        <ul className="cartoes">
          {quadras.map((q) => (
            <li key={q.id} className="cartao">
              <h2>
                <Link href={`/painel/quadras/${q.id}`}>{q.nome}</Link>
              </h2>
              <dl className="dados">
                <div>
                  <dt>Câmera</dt>
                  <dd>
                    <span className={`estado estado-${q.camera ? (q.camera.online ? "on" : "off") : "nenhum"}`}>
                      {textoCamera(q.camera)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Botões ativos</dt>
                  <dd>{q.botoesAtivos}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <section className="secao">
        <FormularioNovaQuadra />
      </section>
    </main>
  );
}

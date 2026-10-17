import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { destinoAposEntrar, ehUuid } from "../apresentacao";
import { quadraEAluno } from "../sessao-aluno";
import { TelaEntrar } from "./tela";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ r?: string | string[] }>;
};

// Entrar a caminho de uma reserva (?r=<uuid>). Sem reserva, a tela de entrar é
// a própria página do QR.
export default async function EntrarAluno({ params, searchParams }: Props) {
  const { slug } = await params;
  const { r } = await searchParams;
  const dados = await quadraEAluno(slug);
  if (!dados) notFound();

  // Só uuid passa adiante; qualquer outro valor é ignorado.
  const reserva = ehUuid(r) ? r : null;
  // Já logado nesta arena, ou sem reserva para seguir: vai direto para o destino.
  if (dados.aluno || !reserva) redirect(destinoAposEntrar(slug, reserva) ?? "/");

  return <TelaEntrar slug={slug} quadra={dados.quadra} reserva={reserva} />;
}

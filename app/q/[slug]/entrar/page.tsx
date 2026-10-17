import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { destinoAposEntrar, ehUuid } from "../apresentacao";
import { quadraEAluno } from "../sessao-aluno";
import { FormularioEntrarAluno } from "./formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ r?: string | string[] }>;
};

export default async function EntrarAluno({ params, searchParams }: Props) {
  const { slug } = await params;
  const { r } = await searchParams;
  const dados = await quadraEAluno(slug);
  if (!dados) notFound();

  // Só uuid passa adiante; qualquer outro valor é ignorado.
  const reserva = ehUuid(r) ? r : null;
  // Já logado nesta arena: segue direto para onde ia.
  if (dados.aluno) redirect(destinoAposEntrar(slug, reserva) ?? "/");

  return (
    <main className="miolo entrar">
      <p className="entrar-quadra">{dados.quadra}</p>
      <h1>Entrar</h1>
      <FormularioEntrarAluno slug={slug} reserva={reserva} />
      <p className="entrar-voltar">
        <a href={`/q/${slug}`}>Voltar para as reservas</a>
      </p>
    </main>
  );
}

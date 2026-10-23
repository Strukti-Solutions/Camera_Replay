import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { arenaDoSlug } from "@/app/lib/arena-slug";
import { poolCompartilhado } from "@/app/lib/pool";

// Slug que não existe é 404; arena existente vai para o login único.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const arena = await arenaDoSlug(poolCompartilhado(), slug);
  return {
    title: arena?.nome ?? "Arena não encontrada",
    robots: { index: false, follow: false },
  };
}

export default async function PaginaDaArena({ params }: Props) {
  const { slug } = await params;
  const arena = await arenaDoSlug(poolCompartilhado(), slug);
  if (!arena) notFound();
  redirect("/entrar");
}

"use server";

import { revalidatePath } from "next/cache";
import { emTransacao } from "@/app/lib/db";
import { apagarClipe, definirEsporteQuadra, renomearQuadra } from "@/app/lib/painel";
import { centavosDeTexto } from "@/app/lib/precos";
import { adicionarFaixas, removerFaixa } from "@/app/lib/precos-quadra";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { mensagemDoErro } from "@/app/painel/apresentacao";
import { exigirSessao } from "@/app/painel/sessao-atual";

// Server Actions são endpoints públicos: cada uma confere a sessão e usa só o
// arenaId dela. O id do clipe que vem do formulário passa por apagarClipe, que
// trata id de outra arena como inexistente.

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome);
  return typeof v === "string" ? v : "";
};

// Apagar usa o formato de estado do formulário de confirmação.
export type EstadoConfirmar = { erro: string | null };

export async function apagarClipeAction(_estado: EstadoConfirmar, form: FormData): Promise<EstadoConfirmar> {
  const sessao = await exigirSessao();
  // Sem R2 não há como apagar o vídeo; apagar só a linha deixaria o arquivo
  // órfão no bucket.
  const config = lerConfigR2();
  if (!config) return { erro: "Armazenamento de vídeos não configurado. Não dá para apagar agora." };
  try {
    const ok = await apagarClipe(poolCompartilhado(), criarR2(config), sessao.arenaId, campo(form, "clipeId"));
    if (!ok) return { erro: "Clipe não encontrado ou ainda em processamento." };
  } catch (e) {
    return { erro: mensagemDoErro(e, "apagar clipe") };
  }
  // Recarrega a lista e o detalhe de quadra. O caminho não vem do formulário.
  revalidatePath("/painel");
  revalidatePath("/painel/quadras/[id]", "page");
  return { erro: null };
}

// ---------- Quadra: nome e esporte ----------

export type EstadoQuadra = { erro: string | null; ok: boolean };

export async function salvarQuadraAction(_estado: EstadoQuadra, form: FormData): Promise<EstadoQuadra> {
  const sessao = await exigirSessao();
  const quadraId = campo(form, "quadraId");
  const esporte = campo(form, "esporte");
  // Confere o esporte antes de gravar o nome, para não salvar pela metade.
  if (esporte.trim().length > 40) return { erro: "Esporte com no máximo 40 caracteres.", ok: false };
  try {
    const db = poolCompartilhado();
    if (!(await renomearQuadra(db, sessao.arenaId, quadraId, campo(form, "nome")))) {
      return { erro: "Quadra não encontrada.", ok: false };
    }
    if (!(await definirEsporteQuadra(db, sessao.arenaId, quadraId, esporte))) {
      return { erro: "Quadra não encontrada.", ok: false };
    }
  } catch (e) {
    return { erro: mensagemDoErro(e, "salvar quadra"), ok: false };
  }
  revalidatePath("/painel");
  revalidatePath("/painel/quadras/[id]", "page");
  return { erro: null, ok: true };
}

// ---------- Preços e horários ----------

// Os valores digitados voltam no estado para o formulário não se apagar no erro.
export type EstadoFaixa = {
  erro: string | null;
  ok: boolean;
  // Muda a cada envio: o formulário remonta com os valores devolvidos.
  versao: number;
  valores: { dias: number[]; inicio: string; fim: string; preco: string };
};

const inteiro = (t: string) => (/^\d{1,2}$/.test(t) ? Number(t) : Number.NaN);

export async function adicionarFaixaAction(estado: EstadoFaixa, form: FormData): Promise<EstadoFaixa> {
  const sessao = await exigirSessao();
  const dias = form
    .getAll("dia")
    .map((v) => (typeof v === "string" ? inteiro(v) : Number.NaN));
  const valores = {
    dias: dias.filter((d) => Number.isInteger(d)),
    inicio: campo(form, "inicio"),
    fim: campo(form, "fim"),
    preco: campo(form, "preco"),
  };
  const versao = estado.versao + 1;
  const falha = (erro: string): EstadoFaixa => ({ erro, ok: false, versao, valores });

  const precoCentavos = centavosDeTexto(valores.preco);
  if (precoCentavos === null) return falha("Preço inválido. Use reais, por exemplo 80 ou 80,50.");
  try {
    const r = await adicionarFaixas(poolCompartilhado(), sessao.arenaId, campo(form, "quadraId"), dias, {
      inicio: inteiro(valores.inicio),
      fim: inteiro(valores.fim),
      precoCentavos,
    });
    if (!r.ok) return falha(r.erro);
  } catch (e) {
    return falha(mensagemDoErro(e, "adicionar faixa de preço"));
  }
  revalidatePath("/painel/quadras/[id]", "page");
  // Sucesso: limpa os dias e o preço, mantém as horas (facilita a faixa seguinte).
  return { erro: null, ok: true, versao, valores: { dias: [], inicio: valores.inicio, fim: valores.fim, preco: "" } };
}

export async function removerFaixaAction(_estado: EstadoConfirmar, form: FormData): Promise<EstadoConfirmar> {
  const sessao = await exigirSessao();
  try {
    const ok = await removerFaixa(poolCompartilhado(), sessao.arenaId, campo(form, "faixaId"));
    if (!ok) return { erro: "Faixa não encontrada." };
  } catch (e) {
    return { erro: mensagemDoErro(e, "remover faixa de preço") };
  }
  revalidatePath("/painel/quadras/[id]", "page");
  return { erro: null };
}

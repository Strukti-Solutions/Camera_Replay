"use server";

import { revalidatePath } from "next/cache";
import { apagarClipe, salvarNomeEsporteQuadra } from "@/app/lib/painel";
import { centavosDeTexto } from "@/app/lib/precos";
import { DURACOES_FIXOS, gerarFixos, minutosDeTexto } from "@/app/lib/horarios";
import { apagarHorario, copiarDia, criarHorario, criarHorarios, editarHorario } from "@/app/lib/horarios-quadra";
import { poolCompartilhado } from "@/app/lib/pool";
import { criarR2, lerConfigR2 } from "@/app/lib/r2";
import { mensagemDoErro } from "@/app/painel/apresentacao";
import { exigirSessao } from "@/app/painel/sessao-atual";
import { resumoLote } from "./horarios-apresentacao";

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
  try {
    const r = await salvarNomeEsporteQuadra(
      poolCompartilhado(), sessao.arenaId, quadraId, campo(form, "nome"), campo(form, "esporte"),
    );
    if (!r.ok) {
      const erro = {
        nome: "O nome deve ter de 1 a 60 caracteres.",
        esporte: "Esporte com no máximo 40 caracteres.",
        quadra: "Quadra não encontrada.",
      }[r.erro];
      return { erro, ok: false };
    }
  } catch (e) {
    return { erro: mensagemDoErro(e, "salvar quadra"), ok: false };
  }
  revalidatePath("/painel");
  revalidatePath("/painel/quadras/[id]", "page");
  return { erro: null, ok: true };
}

// ---------- Horários ----------

// `versao` muda a cada resposta (o formulário percebe que terminou);
// `mensagem` é o texto de sucesso mostrado na tela.
export type EstadoHorario = { erro: string | null; mensagem: string | null; versao: number };

const dia = (form: FormData) => {
  const t = campo(form, "dia");
  return /^[0-6]$/.test(t) ? Number(t) : Number.NaN;
};

// Todas as ações de horário seguem o mesmo roteiro: sessão, corpo, recarga.
async function rodar(
  estado: EstadoHorario,
  contexto: string,
  corpo: (arenaId: string) => Promise<{ erro: string } | { mensagem: string }>,
): Promise<EstadoHorario> {
  const sessao = await exigirSessao();
  const versao = estado.versao + 1;
  try {
    const r = await corpo(sessao.arenaId);
    if ("erro" in r) return { erro: r.erro, mensagem: null, versao };
    revalidatePath("/painel/quadras/[id]", "page");
    return { erro: null, mensagem: r.mensagem, versao };
  } catch (e) {
    return { erro: mensagemDoErro(e, contexto), mensagem: null, versao };
  }
}

const PRECO_INVALIDO = "Preço inválido. Use reais, por exemplo 80 ou 80,50.";
const HORA_INVALIDA = "Hora inválida. Use o formato HH:MM.";

export async function criarHorarioAction(estado: EstadoHorario, form: FormData): Promise<EstadoHorario> {
  return rodar(estado, "criar horário", async (arenaId) => {
    const preco = centavosDeTexto(campo(form, "preco"));
    if (preco === null) return { erro: PRECO_INVALIDO };
    const inicio = minutosDeTexto(campo(form, "inicio"));
    const fim = minutosDeTexto(campo(form, "fim"), true);
    if (inicio === null || fim === null) return { erro: HORA_INVALIDA };
    const r = await criarHorario(poolCompartilhado(), arenaId, campo(form, "quadraId"), {
      diaSemana: dia(form), inicio, fim, precoCentavos: preco,
    });
    return r.ok ? { mensagem: "Horário criado." } : { erro: r.erro };
  });
}

export async function criarFixosAction(estado: EstadoHorario, form: FormData): Promise<EstadoHorario> {
  return rodar(estado, "criar horários", async (arenaId) => {
    const preco = centavosDeTexto(campo(form, "preco"));
    if (preco === null) return { erro: PRECO_INVALIDO };
    const das = minutosDeTexto(campo(form, "das"));
    const ate = minutosDeTexto(campo(form, "ate"), true);
    if (das === null || ate === null) return { erro: HORA_INVALIDA };
    // Só as durações da lista: uma duração fracionada geraria uma lista enorme.
    const duracao = /^\d{1,3}$/.test(campo(form, "duracao")) ? Number(campo(form, "duracao")) : Number.NaN;
    if (!DURACOES_FIXOS.includes(duracao)) return { erro: "Duração inválida." };
    const novos = gerarFixos({ diaSemana: dia(form), das, ate, duracao, precoCentavos: preco });
    if (novos.length === 0) return { erro: "Nenhum horário cabe entre essas horas." };
    const r = await criarHorarios(poolCompartilhado(), arenaId, campo(form, "quadraId"), novos);
    return r.ok ? { mensagem: resumoLote(r.criados, r.pulados) } : { erro: r.erro };
  });
}

export async function editarHorarioAction(estado: EstadoHorario, form: FormData): Promise<EstadoHorario> {
  return rodar(estado, "editar horário", async (arenaId) => {
    const preco = centavosDeTexto(campo(form, "preco"));
    if (preco === null) return { erro: PRECO_INVALIDO };
    const inicio = minutosDeTexto(campo(form, "inicio"));
    const fim = minutosDeTexto(campo(form, "fim"), true);
    if (inicio === null || fim === null) return { erro: HORA_INVALIDA };
    const r = await editarHorario(poolCompartilhado(), arenaId, campo(form, "horarioId"), {
      inicio, fim, precoCentavos: preco,
    });
    return r.ok ? { mensagem: "Horário atualizado." } : { erro: r.erro };
  });
}

export async function apagarHorarioAction(estado: EstadoHorario, form: FormData): Promise<EstadoHorario> {
  return rodar(estado, "apagar horário", async (arenaId) => {
    const ok = await apagarHorario(poolCompartilhado(), arenaId, campo(form, "horarioId"));
    return ok ? { mensagem: "Horário apagado." } : { erro: "Horário não encontrado." };
  });
}

export async function copiarDiaAction(estado: EstadoHorario, form: FormData): Promise<EstadoHorario> {
  return rodar(estado, "copiar dia", async (arenaId) => {
    const destinos = form.getAll("destino").map((v) => (typeof v === "string" && /^[0-6]$/.test(v) ? Number(v) : Number.NaN));
    const r = await copiarDia(poolCompartilhado(), arenaId, campo(form, "quadraId"), dia(form), destinos);
    return r.ok ? { mensagem: resumoLote(r.criados, r.pulados) } : { erro: r.erro };
  });
}

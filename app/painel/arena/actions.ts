"use server";

import { atualizarArenaDono } from "@/app/lib/arena-dono";
import { criarGeocodificador } from "@/app/lib/geocodificar";
import { poolCompartilhado } from "@/app/lib/pool";
import { exigirSessao } from "../sessao-atual";

export type EstadoArena = { erro: string | null; ok: string | null };

// A arena vem sempre da sessão, nunca do formulário.
export async function salvarArenaAction(_e: EstadoArena, form: FormData): Promise<EstadoArena> {
  const { arenaId } = await exigirSessao();
  const campo = (n: string) => String(form.get(n) ?? "");
  const r = await atualizarArenaDono(
    poolCompartilhado(), arenaId,
    {
      nome: campo("nome"),
      endereco: {
        rua: campo("rua"), numero: campo("numero"), bairro: campo("bairro"),
        cidade: campo("cidade"), uf: campo("uf"), cep: campo("cep"),
      },
    },
    criarGeocodificador(),
  );
  if (!r.ok) return { erro: r.erro, ok: null };
  return {
    erro: null,
    ok: r.localizada
      ? "Arena salva."
      : "Endereço salvo, mas não foi possível localizá-lo no mapa. Confira o endereço.",
  };
}

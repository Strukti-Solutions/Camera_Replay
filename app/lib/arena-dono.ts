import type { Db } from "./db";
import type { Geocodificar } from "./geocodificar";

export type EnderecoArena = { rua: string; numero: string; bairro: string; cidade: string; uf: string; cep: string };

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB",
  "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

const tam = (s: string, min: number, max: number) => s.length >= min && s.length <= max;

export function validarEndereco(e: EnderecoArena): { ok: true; endereco: EnderecoArena } | { ok: false; erro: string } {
  const endereco: EnderecoArena = {
    rua: String(e.rua ?? "").trim(),
    numero: String(e.numero ?? "").trim(),
    bairro: String(e.bairro ?? "").trim(),
    cidade: String(e.cidade ?? "").trim(),
    uf: String(e.uf ?? "").trim().toUpperCase(),
    cep: String(e.cep ?? "").trim().replace(/[-.\s]/g, ""),
  };
  if (!tam(endereco.rua, 1, 120)) return { ok: false, erro: "Informe a rua (até 120 caracteres)." };
  if (!tam(endereco.numero, 1, 20)) return { ok: false, erro: "Informe o número (até 20 caracteres)." };
  if (!tam(endereco.bairro, 0, 80)) return { ok: false, erro: "O bairro tem no máximo 80 caracteres." };
  if (!tam(endereco.cidade, 1, 80)) return { ok: false, erro: "Informe a cidade (até 80 caracteres)." };
  if (!(UFS as readonly string[]).includes(endereco.uf)) return { ok: false, erro: "Escolha o estado (UF)." };
  if (!/^\d{8}$/.test(endereco.cep)) return { ok: false, erro: "O CEP deve ter 8 dígitos." };
  return { ok: true, endereco };
}

type Linha = {
  nome: string; endereco_rua: string | null; endereco_numero: string | null; endereco_bairro: string | null;
  endereco_cidade: string | null; endereco_uf: string | null; endereco_cep: string | null;
  latitude: number | null; longitude: number | null;
};

export async function dadosArenaDono(
  db: Db, arenaId: string,
): Promise<{ nome: string; endereco: EnderecoArena | null; temCoordenadas: boolean } | null> {
  if (!ehUuid(arenaId)) return null;
  const r = await db.query<Linha>(
    `select nome, endereco_rua, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf,
            endereco_cep, latitude, longitude
       from arenas where id = $1`,
    [arenaId],
  );
  const l = r.rows[0];
  if (!l) return null;
  const endereco = l.endereco_rua === null ? null : {
    rua: l.endereco_rua, numero: l.endereco_numero ?? "", bairro: l.endereco_bairro ?? "",
    cidade: l.endereco_cidade ?? "", uf: l.endereco_uf ?? "", cep: l.endereco_cep ?? "",
  };
  return { nome: l.nome, endereco, temCoordenadas: l.latitude !== null && l.longitude !== null };
}

export async function atualizarArenaDono(
  db: Db, arenaId: string, dados: { nome: string; endereco: EnderecoArena }, geocodificar: Geocodificar,
): Promise<{ ok: true; localizada: boolean } | { ok: false; erro: string }> {
  if (!ehUuid(arenaId)) return { ok: false, erro: "Arena não encontrada." };
  const nome = String(dados.nome ?? "").trim();
  if (!tam(nome, 1, 80)) return { ok: false, erro: "O nome da arena deve ter de 1 a 80 caracteres." };
  const v = validarEndereco(dados.endereco);
  if (!v.ok) return v;
  const e = v.endereco;

  const atual = await dadosArenaDono(db, arenaId);
  if (!atual) return { ok: false, erro: "Arena não encontrada." };
  const a = atual.endereco;
  const mudou = !a || (Object.keys(e) as (keyof EnderecoArena)[]).some((k) => a[k] !== e[k]);

  // Endereço novo: as coordenadas antigas saem junto com a gravação.
  await db.query(
    `update arenas set nome = $2, endereco_rua = $3, endereco_numero = $4, endereco_bairro = $5,
       endereco_cidade = $6, endereco_uf = $7, endereco_cep = $8,
       latitude = case when $9::boolean then null else latitude end,
       longitude = case when $9::boolean then null else longitude end
     where id = $1`,
    [arenaId, nome, e.rua, e.numero, e.bairro, e.cidade, e.uf, e.cep, mudou],
  );
  if (!mudou && atual.temCoordenadas) return { ok: true, localizada: true };

  let coord = null;
  try {
    coord = await geocodificar(`${e.rua}, ${e.numero}, ${e.bairro}, ${e.cidade} - ${e.uf}, ${e.cep}, Brasil`);
  } catch {
    coord = null;
  }
  if (!coord) return { ok: true, localizada: false };
  await db.query("update arenas set latitude = $2, longitude = $3 where id = $1", [arenaId, coord.latitude, coord.longitude]);
  return { ok: true, localizada: true };
}

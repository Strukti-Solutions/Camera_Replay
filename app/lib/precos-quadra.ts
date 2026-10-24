import { emTransacao, type Db } from "./db";
import { NOMES_DIAS, sobrepoe, textoHora, validarFaixa, type Faixa } from "./precos";

// Tabela de preços de uma quadra no banco. Sempre recebe o arena_id da sessão:
// quadra ou faixa de outra arena se comporta como inexistente.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

type LinhaFaixa = { id: string; dia_semana: number; inicio: number; fim: number; preco_centavos: number };

const paraFaixa = (r: LinhaFaixa): Faixa & { id: string } => ({
  id: r.id,
  diaSemana: Number(r.dia_semana),
  inicio: Number(r.inicio),
  fim: Number(r.fim),
  precoCentavos: Number(r.preco_centavos),
});

export async function listarFaixas(db: Db, arenaId: string, quadraId: string): Promise<(Faixa & { id: string })[]> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return [];
  const { rows } = await db.query<LinhaFaixa>(
    `select id, dia_semana, inicio, fim, preco_centavos from precos_quadra
      where quadra_id = $1 and arena_id = $2
      order by dia_semana, inicio, id`,
    [quadraId, arenaId],
  );
  return rows.map(paraFaixa);
}

// Uma faixa por dia marcado, tudo ou nada. Concorrência: a transação trava a
// linha da quadra (for no key update) antes de ler as faixas existentes, então dois
// pedidos simultâneos para a mesma quadra passam um de cada vez e o segundo
// enxerga o que o primeiro gravou (em read committed cada comando tira um
// snapshot novo; por isso a trava e a leitura ficam em comandos separados).
export async function adicionarFaixas(
  db: Db,
  arenaId: string,
  quadraId: string,
  dias: number[],
  f: { inicio: number; fim: number; precoCentavos: number },
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!ehUuid(arenaId) || !ehUuid(quadraId)) return { ok: false, erro: "Quadra não encontrada." };
  const unicos = [...new Set(dias)].sort((x, y) => x - y);
  if (unicos.length === 0) return { ok: false, erro: "Marque pelo menos um dia." };
  const novas: Faixa[] = unicos.map((d) => ({ diaSemana: d, inicio: f.inicio, fim: f.fim, precoCentavos: f.precoCentavos }));
  for (const n of novas) {
    const erro = validarFaixa(n);
    if (erro) return { ok: false, erro };
  }

  return emTransacao(db, async (tx) => {
    const q = await tx.query("select id from quadras where id = $1 and arena_id = $2 for no key update", [quadraId, arenaId]);
    if (q.rows.length === 0) return { ok: false as const, erro: "Quadra não encontrada." };

    const existentes = (
      await tx.query<LinhaFaixa>(
        `select id, dia_semana, inicio, fim, preco_centavos from precos_quadra
          where quadra_id = $1 and arena_id = $2 and dia_semana = any($3::smallint[])`,
        [quadraId, arenaId, unicos],
      )
    ).rows.map(paraFaixa);
    // Os dias da leva são distintos, então só pode sobrepor uma existente.
    const conflito = novas.find((n) => existentes.some((e) => sobrepoe(n, e)));
    if (conflito) {
      return {
        ok: false as const,
        erro: `Já existe preço para ${NOMES_DIAS[conflito.diaSemana]} entre ${textoHora(f.inicio)} e ${textoHora(f.fim)}.`,
      };
    }

    // Gravação num comando só: ou entram todas as faixas, ou nenhuma.
    await tx.query(
      `insert into precos_quadra (arena_id, quadra_id, dia_semana, inicio, fim, preco_centavos)
       select $1, $2, d, $4, $5, $6 from unnest($3::smallint[]) as d`,
      [arenaId, quadraId, unicos, f.inicio, f.fim, f.precoCentavos],
    );
    return { ok: true as const };
  });
}

export async function removerFaixa(db: Db, arenaId: string, faixaId: string): Promise<boolean> {
  if (!ehUuid(arenaId) || !ehUuid(faixaId)) return false;
  const r = await db.query("delete from precos_quadra where id = $1 and arena_id = $2 returning id", [faixaId, arenaId]);
  return r.rows.length === 1;
}

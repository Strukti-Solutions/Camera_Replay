import { expect, test } from "vitest";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../app/lib/db";
import { migrar } from "../db/migrar";
import { novoBanco } from "./db";
import { criarArena, criarBotao, criarCamera, criarQuadra } from "./fixtures";

// Decisão do Thiago em 26/10 (Q12/Q22 da página do replay): o lance fica 7 dias,
// como diz o vídeo, inclusive nas arenas que já existem.

test("arena nova nasce com 7 dias de retenção", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  const r = await db.query<{ dias_retencao: number }>("select dias_retencao from arenas where id = $1", [a.id]);
  expect(r.rows[0].dias_retencao).toBe(7);
});

test("o banco aceita até 7 e recusa 8", async () => {
  const db = await novoBanco();
  const a = await criarArena(db);
  await db.query("update arenas set dias_retencao = 7 where id = $1", [a.id]);
  await expect(db.query("update arenas set dias_retencao = 8 where id = $1", [a.id]))
    .rejects.toThrow(/arenas_dias_retencao_check/);
});

// Clipe com recebido_em `idadeDias` atrás e o prazo de 3 dias da 0007.
async function clipeDeTresDias(
  db: Db, arenaId: string, botaoId: string, cameraId: string, idadeDias: number,
): Promise<string> {
  const ap = await db.query<{ id: string }>(
    `insert into apertos (arena_id, botao_id, recebido_em)
     values ($1, $2, now() - make_interval(days => $3)) returning id`,
    [arenaId, botaoId, idadeDias]);
  const r = await db.query<{ id: string }>(
    `insert into clipes (arena_id, aperto_id, camera_id, status, recebido_em, expira_em)
     select arena_id, id, $2, 'pronto', recebido_em, recebido_em + interval '3 days'
       from apertos where id = $1 returning id`,
    [ap.rows[0].id, cameraId]);
  return r.rows[0].id;
}

test("a migração passa as arenas existentes para 7 e estende os lances ainda guardados", async () => {
  // Banco parado na 0023, com retenção de 3 dias (e uma arena com 1 dia).
  const pasta = mkdtempSync(join(tmpdir(), "mig-"));
  try {
    const todas = join(__dirname, "..", "db", "migrations");
    for (const f of readdirSync(todas).filter((x) => x < "0024")) cpSync(join(todas, f), join(pasta, f));
    const db = await novoBanco(pasta);

    const a = await criarArena(db);
    await db.query("update arenas set dias_retencao = 3 where id = $1", [a.id]);
    const b = await criarArena(db);
    await db.query("update arenas set dias_retencao = 1 where id = $1", [b.id]);
    const q = await criarQuadra(db, a.id);
    const c = await criarCamera(db, a.id, q.id);
    const bt = await criarBotao(db, a.id, q.id, c.id);
    const guardado = await clipeDeTresDias(db, a.id, bt.id, c.id, 1);
    // Expirou há 1 dia e espera a limpeza (que apaga quando expira_em < now()): não volta.
    const expirado = await clipeDeTresDias(db, a.id, bt.id, c.id, 4);

    expect(await migrar(db)).toEqual(["0024_retencao_7_dias.sql"]);

    const ar = await db.query<{ id: string; dias_retencao: number }>("select id, dias_retencao from arenas");
    expect(Object.fromEntries(ar.rows.map((x) => [x.id, x.dias_retencao]))).toEqual({ [a.id]: 7, [b.id]: 7 });
    const cl = await db.query<{ id: string; sete: boolean; tres: boolean }>(
      `select id, (expira_em = recebido_em + interval '7 days') as sete,
              (expira_em = recebido_em + interval '3 days') as tres
         from clipes`);
    const por = Object.fromEntries(cl.rows.map((x) => [x.id, x]));
    expect(por[guardado].sete).toBe(true);
    expect(por[expirado].tres).toBe(true);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

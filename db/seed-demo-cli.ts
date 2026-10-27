import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarPool } from "../app/lib/db";
import { lerChave } from "../app/lib/cripto";
import { comSegredosNoEnv, semearDemo, urlLocal, type SegredosDemo } from "./seed-demo";

// npm run seed-demo: monta a Arena Exemplo no banco LOCAL (o mesmo do next dev).
// Recusa qualquer DATABASE_URL que não seja localhost, 127.0.0.1 ou ::1.
// As senhas e o token do botão criados vão só para o .env.local; nunca para a
// tela. Nunca imprime a URL do banco.

const ENV_LOCAL = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

// Grava o que foi criado, mesmo que a semeadura tenha parado no meio: uma
// segunda rodada não recria contas nem botão, então não haveria outra chance.
function gravarSegredos(segredos: SegredosDemo): void {
  const nomes = Object.keys(segredos);
  if (nomes.length === 0) return;
  try {
    const atual = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, "utf8") : "";
    writeFileSync(ENV_LOCAL, comSegredosNoEnv(atual, segredos));
    console.log(`Gravado no .env.local: ${nomes.join(", ")}.`);
  } catch (e) {
    console.error(`seed-demo: ${nomes.join(", ")} foram criados, mas o .env.local não foi gravado:`,
      e instanceof Error ? e.message : "erro desconhecido");
    console.error("Use \"Esqueci a senha\" em /entrar (sem SMTP, o link sai no terminal do next dev) e crie outro botão em /admin.");
    process.exitCode = 1;
  }
}

async function principal(): Promise<void> {
  // O .env.local do app entra sem sobrescrever o que já está no ambiente.
  if (existsSync(ENV_LOCAL)) process.loadEnvFile(ENV_LOCAL);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("seed-demo: defina DATABASE_URL (no ambiente ou no .env.local)");
    process.exit(2);
  }
  if (!urlLocal(url)) {
    console.error("seed-demo: recusado: DATABASE_URL não é um banco local (localhost, 127.0.0.1 ou ::1)");
    process.exit(2);
  }
  // Com CAMERA_CRED_KEY, as credenciais de mentira da câmera ficam cifradas com
  // a chave do app; sem ela, com uma chave descartável.
  const chave = process.env.CAMERA_CRED_KEY ? lerChave() : undefined;
  const db = criarPool(url);
  const segredos: SegredosDemo = {};
  try {
    const r = await semearDemo(db, { chave, segredos });
    console.log(`Arena Exemplo pronta: /a/${r.arenaSlug}`);
  } finally {
    gravarSegredos(segredos);
    await (db as unknown as { end(): Promise<void> }).end();
  }
}

principal().catch((e) => {
  // Só a mensagem; nunca senha, token nem a DATABASE_URL.
  console.error("seed-demo: falhou:", e instanceof Error ? e.message : "erro desconhecido");
  process.exit(1);
});

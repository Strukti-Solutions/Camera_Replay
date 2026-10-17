import { criarPool } from "../app/lib/db";
import { migrar } from "./migrar";

// Aplica as migrações em DATABASE_URL e imprime os nomes aplicados.
// Nunca imprime a URL.
async function principal(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("migrar: defina DATABASE_URL");
    process.exit(2);
  }
  const db = criarPool();
  try {
    const aplicadas = await migrar(db);
    console.log(aplicadas.length ? `Aplicadas:\n${aplicadas.join("\n")}` : "Nada a aplicar.");
  } finally {
    await (db as unknown as { end(): Promise<void> }).end();
  }
}

principal().catch((e) => {
  console.error("migrar: falhou:", e instanceof Error ? e.message : "erro desconhecido");
  process.exit(1);
});

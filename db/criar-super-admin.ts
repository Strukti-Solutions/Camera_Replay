import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { criarPool } from "../app/lib/db";
import { criarSuperAdmin } from "../app/lib/plataforma";

// Lê uma linha do stdin. Em terminal (TTY) não ecoa o que é digitado.
function lerSenha(): Promise<string> {
  const entrada = process.stdin;
  if (entrada.isTTY) {
    return new Promise((resolve) => {
      process.stderr.write("Senha: ");
      let senha = "";
      entrada.setRawMode(true);
      entrada.resume();
      entrada.setEncoding("utf8");
      const aoReceber = (tecla: string) => {
        for (const c of tecla) {
          if (c === "\r" || c === "\n" || c === "\u0004") {
            entrada.setRawMode(false);
            entrada.pause();
            entrada.off("data", aoReceber);
            process.stderr.write("\n");
            return resolve(senha);
          }
          if (c === "\u0003") process.exit(130); // Ctrl+C
          if (c === "\u007f" || c === "\b") senha = senha.slice(0, -1);
          else senha += c;
        }
      };
      entrada.on("data", aoReceber);
    });
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: entrada });
    let linha = "";
    rl.once("line", (l) => {
      linha = l;
      rl.close();
    });
    rl.once("close", () => resolve(linha));
  });
}

async function principal(): Promise<void> {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  if (!values.email) {
    console.error("uso: npm run criar-super-admin -- --email <email>   (senha na entrada padrão, mínimo 12 caracteres)");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("criar-super-admin: defina DATABASE_URL");
    process.exit(2);
  }
  const senha = await lerSenha();
  const db = criarPool();
  try {
    const r = await criarSuperAdmin(db, { email: values.email, senha });
    console.log(`Super admin criado (id ${r.id}): ${values.email.trim().toLowerCase()}.`);
  } finally {
    await (db as unknown as { end(): Promise<void> }).end();
  }
}

principal().catch((e) => {
  // Só a mensagem; nunca a senha nem a DATABASE_URL.
  console.error("criar-super-admin:", e instanceof Error ? e.message : "erro desconhecido");
  process.exit(1);
});

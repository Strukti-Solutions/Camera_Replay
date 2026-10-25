import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "vitest";

// Server Actions e rotas de /admin são endpoints públicos: o primeiro `await` de
// cada uma confere a sessão de super admin, direto ou por uma função local que
// começa por isso (arenaConferida, arenaDoForm, mudarStatus…). Antes dele, só
// leitura do formulário (nada de banco nem R2). Um `return f()` também conta.
// Fica de fora só o entrar/sair do admin, que é justamente quem cria a sessão.

const RAIZ = join(__dirname, "..");
const ADMIN = join(RAIZ, "app", "admin");
const SEM_GUARDA = new Set(["app/admin/entrar/actions.ts"]);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

const caminho = (p: string) => relative(RAIZ, p).split(sep).join("/");

// Primeira linha do corpo de cada função com `await` ou `return` (a linha que
// abre o corpo termina em "{"; as assinaturas ocupam uma ou mais linhas antes).
function primeirasLinhas(codigo: string): Map<string, { exportada: boolean; linha: string }> {
  const linhas = codigo.split(/\r?\n/);
  const saida = new Map<string, { exportada: boolean; linha: string }>();
  linhas.forEach((l, i) => {
    const m = /^(export\s+)?async\s+function\s+(\w+)/.exec(l);
    if (!m) return;
    let j = i;
    while (j < linhas.length && !linhas[j].trimEnd().endsWith("{")) j++;
    let k = j + 1;
    while (k < linhas.length && !/\b(?:await|return)\b/.test(linhas[k]) && !/^\S/.test(linhas[k])) k++;
    saida.set(m[2], { exportada: Boolean(m[1]), linha: linhas[k]?.trim() ?? "" });
  });
  return saida;
}

function semGuarda(codigo: string, chamadasDeSessao: string[]): string[] {
  const funcoes = primeirasLinhas(codigo);
  const guardas = new Set(chamadasDeSessao);
  // Funções locais que começam pela sessão também valem como guarda.
  for (const [nome, f] of funcoes) {
    if (!f.exportada && chamadasDeSessao.some((g) => f.linha.includes(`${g}(`))) guardas.add(nome);
  }
  return [...funcoes]
    .filter(([, f]) => f.exportada && ![...guardas].some((g) => f.linha.includes(`${g}(`)))
    .map(([nome, f]) => `${nome}: ${f.linha}`);
}

test("toda Server Action de /admin começa conferindo a sessão de super admin", () => {
  const acoes = arquivos(ADMIN).filter((p) => /actions\.ts$/.test(p) && !SEM_GUARDA.has(caminho(p)));
  expect(acoes.length).toBeGreaterThan(2);
  const achados = acoes.flatMap((p) =>
    semGuarda(readFileSync(p, "utf8"), ["exigirSuperAdmin"]).map((x) => `${caminho(p)} → ${x}`),
  );
  expect(achados).toEqual([]);
});

test("toda rota de /admin começa conferindo a sessão de super admin", () => {
  const rotas = arquivos(ADMIN).filter((p) => /route\.ts$/.test(p));
  expect(rotas.map(caminho)).toContain("app/admin/fotos/[id]/route.ts");
  const achados = rotas.flatMap((p) =>
    semGuarda(readFileSync(p, "utf8"), ["exigirSuperAdmin", "sessaoAdminAtual"]).map((x) => `${caminho(p)} → ${x}`),
  );
  expect(achados).toEqual([]);
});

test("a guarda pega action sem sessão (a verificação não é vazia)", () => {
  const ruim = `export async function apagar(form: FormData): Promise<void> {\n  await apagarTudo(form);\n}`;
  expect(semGuarda(ruim, ["exigirSuperAdmin"])).toEqual(["apagar: await apagarTudo(form);"]);
  const boa = `async function arena(f: FormData) {\n  await exigirSuperAdmin();\n}\nexport async function x(f: FormData) {\n  const a = await arena(f);\n}`;
  expect(semGuarda(boa, ["exigirSuperAdmin"])).toEqual([]);
});

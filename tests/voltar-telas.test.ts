import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Telas de topo: a navegação está no próprio topo (Topo/painel/admin), sem "← Voltar".
const EXCECOES = [
  "app/page.tsx",
  "app/minhas-reservas/page.tsx",
  "app/painel/page.tsx",
  "app/painel/reservas/page.tsx",
  "app/painel/arena/page.tsx",
  "app/admin/page.tsx",
  "app/admin/entrar/page.tsx",
  "app/q/[slug]/page.tsx",
];

export function telasSemVoltar(arquivos: { caminho: string; texto: string }[], excecoes: string[]): string[] {
  return arquivos
    .filter((a) => !excecoes.includes(a.caminho) && !a.texto.includes("LinkVoltar"))
    .map((a) => a.caminho);
}

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return paginas(caminho);
    return nome === "page.tsx" ? [caminho] : [];
  });
}

describe("telasSemVoltar", () => {
  it("acusa tela sem LinkVoltar e aceita a que tem", () => {
    const arquivos = [
      { caminho: "app/x/page.tsx", texto: "<main />" },
      { caminho: "app/y/page.tsx", texto: '<LinkVoltar href="/" />' },
    ];
    expect(telasSemVoltar(arquivos, [])).toEqual(["app/x/page.tsx"]);
    expect(telasSemVoltar(arquivos, ["app/x/page.tsx"])).toEqual([]);
  });
});

describe("Voltar nas telas internas", () => {
  it("toda page.tsx fora da lista de topo usa LinkVoltar", () => {
    const arquivos = paginas("app").map((p) => ({
      caminho: relative(".", p).split(sep).join("/"),
      texto: readFileSync(p, "utf8"),
    }));
    expect(telasSemVoltar(arquivos, EXCECOES)).toEqual([]);
  });

  it("depois de criar a conta, sem destino pedido, vai para a home", () => {
    const texto = readFileSync("app/criar-conta/actions.ts", "utf8");
    expect(texto).toContain('caminhoSeguro(form.get("voltar")) ?? "/")');
  });
});

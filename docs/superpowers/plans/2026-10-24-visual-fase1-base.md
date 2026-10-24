# Visual novo — Fase 1: tema, topo, marca, voltar e largura

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Base visual comum a todas as telas: botão de tema claro/escuro que lembra a escolha, topo novo com "Replay" em destaque e Strukti discreta, "← Voltar" em todas as telas internas e uma largura máxima para o computador.

**Architecture:** O tema vira um atributo `data-tema` no `<html>`, lido de um cookie no layout raiz (sem cookie, segue o sistema). Um componente de topo único (`Topo`) substitui as três faixas atuais (pública, painel, admin). Regras puras (tema, destino de voltar) ficam em arquivos testáveis; um teste de estrutura garante o "Voltar" nas telas internas.

**Tech Stack:** Next.js 15 App Router, React 19, CSS em `app/globals.css`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-visual-novo-design.md` (seções "Topo e marca", "Tema claro e escuro", "Entrar, criar conta, minha conta", metas 1, 8 e 9).

## Global Constraints

- Todo texto em português. Textos exatos: botão de tema com `aria-label` "Usar tema escuro" / "Usar tema claro"; marca "Replay"; assinatura "por Strukti"; link "Voltar" com a seta `←` (componente `LinkVoltar` existente).
- Paleta atual (tokens `--navy-*`, `--electric-*`, `--cyan-*`). Escuro = os valores de hoje do bloco `@media (prefers-color-scheme: dark)`; claro = os valores de hoje do `:root`.
- Sem cookie de tema, o site segue o sistema (`prefers-color-scheme`). Com cookie, vale o cookie.
- Cookie: nome `tema`, valores `claro` ou `escuro`, `path=/`, `max-age` de 1 ano, `SameSite=Lax`. Qualquer outro valor é ignorado (segue o sistema).
- Largura máxima do computador: novo token `--largura-larga: 64rem`. O `--largura: 40rem` atual continua para colunas de leitura e formulários.
- Arquivos `"use server"` só exportam funções assíncronas (`tests/use-server.test.ts`).
- Não rodar `npm run build` com o `next dev` aberto. Testes com `node node_modules/vitest/vitest.mjs run --no-file-parallelism`; typecheck com `node node_modules/typescript/bin/tsc --noEmit`.
- Commits em Conventional Commits, `git add` explícito, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/visual-novo`.

## Review Focus

- Cookie `tema` com valor estranho (`tema=azul`, vazio, repetido): segue o sistema, não quebra a página.
- Primeira pintura no tema escolhido: com cookie `escuro` e sistema claro, a página já chega escura do servidor (sem piscar branco).
- Sem JavaScript, o botão de tema não deve sumir quebrado nem mudar o layout; o site continua legível no tema do sistema.
- "Voltar" nunca leva para fora do site: o destino vem de `caminhoSeguro` ou é fixo.
- Jogador logado que acabou de criar conta acha o caminho para a busca (link "Buscar quadras" no topo).

---

### Task 1: Tema claro/escuro com botão

**Files:**
- Create: `app/componentes/tema.ts` (regras puras)
- Create: `app/componentes/botao-tema.tsx` (`"use client"`)
- Modify: `app/layout.tsx` (lê o cookie, põe `data-tema`, `themeColor` por esquema)
- Modify: `app/globals.css` (cada bloco `@media (prefers-color-scheme: dark) { :root {…} }` passa a valer também com `:root[data-tema="escuro"]` e deixa de valer com `:root[data-tema="claro"]`; `color-scheme` acompanha)
- Test: `tests/tema.test.ts`

**Interfaces:**
- Produces:
  - `type Tema = "claro" | "escuro"`
  - `lerTema(valor: string | undefined): Tema | null` — `"claro"`/`"escuro"` passam, todo o resto vira `null`.
  - `proximoTema(atual: Tema): Tema`
  - `cookieDoTema(tema: Tema): string` — `"tema=escuro; Path=/; Max-Age=31536000; SameSite=Lax"`.
  - `<BotaoTema />` — sem props; descobre o tema efetivo (atributo `data-tema` do `<html>` ou, sem ele, `matchMedia("(prefers-color-scheme: dark)")`), troca o atributo e grava o cookie. Ícone ☀ no claro, ☾ no escuro; `aria-label` "Usar tema escuro" quando está claro e "Usar tema claro" quando está escuro.

- [ ] **Step 1: Testes que falham** em `tests/tema.test.ts`:
  - `lerTema("claro") === "claro"`, `lerTema("escuro") === "escuro"`, `lerTema(undefined) === null`, `lerTema("") === null`, `lerTema("azul") === null`, `lerTema("ESCURO") === null`.
  - `proximoTema("claro") === "escuro"` e o inverso.
  - `cookieDoTema("escuro") === "tema=escuro; Path=/; Max-Age=31536000; SameSite=Lax"`.
  - Teste de CSS (lê `app/globals.css` como texto): para cada bloco `@media (prefers-color-scheme: dark)` existe a regra correspondente com `:root[data-tema="escuro"]`, e o bloco do media passa a usar `:root:not([data-tema="claro"])`. Assertiva simples: a contagem de `@media (prefers-color-scheme: dark)` é igual à de `[data-tema="escuro"]`, e nenhum `@media (prefers-color-scheme: dark)` contém `:root {` sem o `:not([data-tema="claro"])`.
- [ ] **Step 2:** rodar `node node_modules/vitest/vitest.mjs run tests/tema.test.ts` → FALHA (módulo não existe).
- [ ] **Step 3:** implementar `tema.ts`, o CSS e o `layout.tsx` (`cookies()` de `next/headers`, `data-tema={lerTema(...) ?? undefined}`; `viewport.themeColor` como lista por `media` com o fundo de cada tema). Em `globals.css`, duplicar os tokens escuros sem inventar valores novos.
- [ ] **Step 4:** implementar `BotaoTema`. Ele ainda não aparece em nenhuma tela (entra no topo na Task 2).
- [ ] **Step 5:** testes do arquivo e `tsc --noEmit` passam.
- [ ] **Step 6:** commit `feat(tema): claro e escuro com cookie e botão`.

### Task 2: Topo único com a marca Replay

**Files:**
- Create: `app/componentes/topo.tsx`
- Modify: `app/componentes/marca.tsx` (nova `MarcaReplay`; `AssinaturaStrukti` continua para quem usa)
- Modify: `app/componentes/cabecalho-publico.tsx`, `app/painel/layout.tsx`, `app/admin/cabecalho.tsx` (passam a usar `Topo`)
- Modify: `app/globals.css` (estilos do topo; `--largura-larga: 64rem`; classe `.miolo-largo` com `max-width: var(--largura-larga)`)
- Test: `tests/topo.test.ts`

**Interfaces:**
- Consumes: `BotaoTema` (Task 1).
- Produces:
  - `MarcaReplay()` — link para `/` com o texto "Replay" em destaque e, ao lado, o símbolo da Strukti pequeno (`/brand/strukti-simbolo-fundo-claro.svg` no claro, `-fundo-escuro.svg` no escuro, altura 14 px) e o texto "por Strukti" em tinta suave, opacidade reduzida. `alt` do símbolo vazio (o texto já diz Strukti).
  - `Topo({ children, rotulo }: { children?: ReactNode; rotulo?: string })` — `<header>` com `MarcaReplay`, `rotulo` opcional (ex.: nome da arena no painel, "Administração" no admin), `children` (navegação e Sair) e `BotaoTema` sempre por último. Conteúdo dentro de `.miolo-largo`. O topo segue o tema (fundo `--superficie` no claro, `--fundo` do escuro), não mais a faixa sempre escura.
  - `linksDoCabecalhoPublico(logado: boolean, voltar: string | null): { href: string; texto: string }[]` em `app/componentes/topo-links.ts` — logado: `[{ "/", "Buscar quadras" }, { "/minhas-reservas", "Minhas reservas" }, { "/minha-conta", "Minha conta" }]`; deslogado: `[{ "/entrar" + "?voltar=…" se houver, "Entrar" }, { "/criar-conta" + "?voltar=…" se houver, "Criar conta" }]`. O `voltar` já chega validado.
- `CabecalhoPublico` ganha a prop opcional `voltar?: string | null` e usa `linksDoCabecalhoPublico`. As páginas que já sabem onde estão passam o próprio caminho (página da arena, `/reservar`).

- [ ] **Step 1: Testes que falham** em `tests/topo.test.ts` para `linksDoCabecalhoPublico`:
  - logado → os três links acima, nessa ordem.
  - deslogado sem voltar → `/entrar` e `/criar-conta`.
  - deslogado com voltar `/a/abc?quadra=1&dia=2026-10-26` → `href` = `/entrar?voltar=%2Fa%2Fabc%3Fquadra%3D1%26dia%3D2026-10-26` (e o mesmo para criar conta).
- [ ] **Step 2:** rodar o teste → FALHA.
- [ ] **Step 3:** implementar `topo-links.ts`, `MarcaReplay`, `Topo` e trocar os três cabeçalhos. O painel mantém `NavegacaoPainel` e o Sair dentro do `Topo`; o admin mantém o Sair.
- [ ] **Step 4:** testes do arquivo, `tsc` e a suíte toda (`--no-file-parallelism`) passam.
- [ ] **Step 5: Prévia** (dev em `http://localhost:3000`, portais "Site (computador)" e "Jogador (celular)"): home, `/entrar`, `/painel` (dono@teste.local / senha-de-teste-123) e `/admin` (admin@teste.local / admin-teste-12345) com o topo novo nos dois temas; o botão troca o tema e, depois de recarregar, o tema continua.
- [ ] **Step 6:** commit `feat(topo): marca Replay, Strukti discreta e botão de tema`.

### Task 3: "Voltar" em todas as telas internas

**Files:**
- Modify: `app/a/[slug]/page.tsx` (Voltar → `/`), `app/minhas-reservas/[id]/page.tsx` (→ `/minhas-reservas`), `app/painel/quadras/[id]/page.tsx` (→ `/painel`), `app/admin/arenas/[id]/page.tsx` (→ `/admin`)
- Modify: `app/criar-conta/actions.ts` (sem `voltar`, depois de criar a conta vai para `/` em vez de `/minhas-reservas`)
- Test: `tests/voltar-telas.test.ts`

**Interfaces:**
- Consumes: `LinkVoltar({ href })` existente; `CabecalhoPublico` com "Buscar quadras" (Task 2).

- [ ] **Step 1: Teste de estrutura que falha** em `tests/voltar-telas.test.ts`: percorre todos os `app/**/page.tsx` e exige `LinkVoltar` em cada um, exceto a lista de telas de topo (que têm navegação no próprio topo): `app/page.tsx`, `app/minhas-reservas/page.tsx`, `app/painel/page.tsx`, `app/painel/reservas/page.tsx`, `app/painel/arena/page.tsx`, `app/admin/page.tsx`, `app/admin/entrar/page.tsx`, `app/q/[slug]/page.tsx`. Inclui um caso-controle: a função pura `telasSemVoltar(arquivos: { caminho: string; texto: string }[], excecoes: string[]): string[]` acusa um arquivo falso sem `LinkVoltar` e não acusa um que tem.
- [ ] **Step 2:** rodar → FALHA listando as 4 telas acima.
- [ ] **Step 3:** pôr `LinkVoltar` nas 4 telas, logo abaixo do topo, com os destinos acima; mudar o destino padrão do cadastro.
- [ ] **Step 4:** ajustar o teste existente do cadastro, se houver um que espere `/minhas-reservas` sem `voltar`; rodar a suíte toda e o `tsc`.
- [ ] **Step 5: Prévia:** criar uma conta pela home → cai na home logado, com "Buscar quadras", "Minhas reservas" e "Minha conta" no topo; abrir uma arena e voltar; abrir uma quadra no painel e voltar.
- [ ] **Step 6:** commit `feat(navegacao): voltar em todas as telas internas`.

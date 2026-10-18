# Lista de alunos com busca e páginas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arenas com muitos alunos continuam usáveis: a lista de alunos do painel e a escolha de alunos (nova reserva, editar alunos da reserva, atribuir lance) ganham busca e páginas de 10.

**Architecture:** A tabela `/painel/alunos` passa a buscar e paginar no banco (`?busca=` e `?pagina=` na URL, funciona sem JavaScript). A escolha de alunos dentro dos formulários continua recebendo a lista da arena, mas o componente mostra uma busca e páginas de 10 no navegador; os alunos já marcados ficam sempre visíveis no topo e continuam no envio do formulário mesmo fora da página atual. Sem JavaScript, a escolha mostra a lista inteira, como hoje.

**Tech Stack:** o mesmo (Next.js 15, Postgres, Vitest + PGlite).

**Spec:** `docs/superpowers/specs/2026-10-16-replay-saas-design.md`.

## Decisões do dono (17/10)

- Lista de alunos com páginas a partir de uns 10 alunos e barra de pesquisa, no cadastro de alunos e na edição da reserva.

## Global Constraints

- Branch `feat/alunos-lista`, a partir de `main`. `npm test`, `npm run typecheck`; build pelo controller.
- Toda consulta filtra por `arena_id` da sessão; a busca é parametrizada (sem `LIKE` com entrada crua; usar `position(lower($x) in lower(...))` como em `arenas-publicas.ts`), aparada e cortada em 80 caracteres.
- pt-BR, WCAG AA, alvos ≥ 44 px, identidade visual Strukti já aplicada (tokens em `app/globals.css`).
- Donos de pasta: Tarefa 1 → `backend`; Tarefa 2 → web (páginas e componentes em `app/painel`).

## Review Focus

- **Aluno marcado fora da página visível** continua marcado e é enviado ao salvar a reserva.
- **Busca com `%`, `_` ou aspas** não quebra nem vira curinga.
- **Página além da última** (`?pagina=99`) mostra a última página, não erro nem lista vazia.
- **Dono da arena A** nunca vê alunos da arena B pela busca.

---

### Task 1: `listarAlunos` com busca e página (dono: backend)

**Files:** Modify `app/lib/alunos.ts`; Test `tests/alunos.test.ts`.

**Interfaces:**
- `listarAlunos(db, arenaId, { busca?: string; pagina?: number; porPagina?: number } = {}) → { alunos: AlunoLista[]; total: number; pagina: number; paginas: number }`. Busca por nome ou e-mail (sem diferenciar maiúsculas), ordem por nome, `porPagina` padrão 10 (máx. 50), `pagina` começa em 1 e é presa entre 1 e `paginas` (`paginas` ≥ 1 mesmo sem alunos).
- `listarAlunosParaEscolha(db, arenaId) → { id, nome }[]` (todos da arena, por nome; é o que os formulários de reserva e atribuição usam).
- Os chamadores atuais de `listarAlunos` passam a usar a função certa.

- [ ] **Step 1: Testes que falham:** 23 alunos → página 1 tem 10, página 3 tem 3, `paginas = 3`, `total = 23`; `pagina = 99` vira 3; `pagina = 0` vira 1; busca por parte do nome e do e-mail; busca com `%` e `_` acha só nomes que contêm esses caracteres; outra arena nunca aparece; sem alunos → `paginas = 1`, lista vazia.
- [ ] **Step 2:** falha. **Step 3:** implementar. **Step 4:** `npm test`, `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(alunos): lista de alunos com busca e páginas`.

### Task 2: Busca e páginas nas telas (dono: web)

**Files:** Modify `app/painel/alunos/page.tsx`, `app/painel/escolha-alunos.tsx`, `app/painel/reservas/page.tsx`, `app/painel/quadras/[id]/page.tsx`, `app/globals.css`.

- [ ] **Step 1: `/painel/alunos`:** formulário GET com campo "Buscar aluno" (nome ou e-mail) e botão "Buscar"; tabela com 10 por página; abaixo, "Página X de Y" e links "Anterior" / "Próxima" (desabilitados nas pontas) que mantêm a busca; total "N alunos"; sem resultado: "Nenhum aluno encontrado." O formulário "Novo aluno" continua na página.
- [ ] **Step 2: Escolha de alunos** (nova reserva, editar alunos da reserva, atribuir lance): campo "Buscar aluno" que filtra no navegador; mostra 10 por vez com "Anterior"/"Próxima" e "Página X de Y"; os marcados aparecem sempre primeiro, com a contagem "N selecionados"; marcar ou desmarcar em qualquer página vale no envio. Sem JavaScript, a lista inteira aparece como hoje.
- [ ] **Step 3:** `npm run typecheck`, `npm test`; o controller confere na prévia com muitos alunos de teste e roda o build.
- [ ] **Step 4: Commit** `feat(web): busca e páginas na lista e na escolha de alunos`.

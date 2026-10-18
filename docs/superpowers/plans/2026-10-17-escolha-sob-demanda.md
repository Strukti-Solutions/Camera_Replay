# Escolha de alunos em página própria

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela da quadra e a de reservas param de carregar a lista inteira de alunos uma vez por lance e por reserva. "Editar alunos" (reserva) e "Atribuir a alunos" (lance) viram links para uma página própria, que carrega os alunos uma vez só.

**Architecture:** Duas páginas novas no painel: `/painel/reservas/<id>/alunos` e `/painel/lances/<id>/alunos`. Cada uma chama `exigirSessao()`, busca o item da arena da sessão (404 se não for dela), carrega `listarAlunosParaEscolha` uma vez e mostra o seletor existente (`app/painel/escolha-alunos.tsx`, com busca e páginas de 10). Salvar usa as actions que já existem (`definirAlunosDaReserva`, `atribuirClipe`) e volta para a tela de origem com a mensagem de sucesso. As listas de reserva e de lances deixam de renderizar o seletor e mostram só os avatares/nomes atuais e o link.

**Spec:** `docs/superpowers/specs/2026-10-16-replay-saas-design.md`.

## Global Constraints

- Branch `feat/escolha-sob-demanda`, a partir de `main`. `npm test`, `npm run typecheck`; build pelo controller.
- Toda página e action chama `exigirSessao()` e usa só o `arenaId` dela; id malformado ou de outra arena → 404.
- Funciona sem JavaScript (o seletor mostra a lista inteira, como hoje). pt-BR, WCAG AA, identidade Strukti.

## Review Focus

- **Dono da arena A abre `/painel/reservas/<id de B>/alunos`**: 404, nada da outra arena.
- **Salvar volta para a tela certa** (lista de reservas ou detalhe da quadra do lance) com "Alunos da reserva salvos." / "Atribuição salva.".
- **Tela da quadra com muitos lances**: o HTML não contém mais a lista de alunos por lance.

---

### Task 1: Páginas de escolha e listas enxutas (dono: web, com duas funções de leitura em `app/lib`)

**Files:**
- Create: `app/painel/reservas/[id]/alunos/page.tsx`, `app/painel/lances/[id]/alunos/page.tsx`
- Modify: `app/painel/reservas/page.tsx`, `app/painel/quadras/[id]/page.tsx`, as actions de salvar (redirecionar com mensagem), `app/lib/reservas.ts` (`reservaParaEditar(db, arenaId, reservaId) → { id, quadraNome, inicio, fim, alunoIds } | null`), `app/lib/painel.ts` (`clipeParaAtribuir(db, arenaId, clipeId) → { id, quadraId, quadraNome, recebidoEm, alunoIds } | null`)
- Test: `tests/reservas.test.ts`, `tests/painel.test.ts`

- [ ] **Step 1: Testes que falham** das duas funções de leitura: devolvem os alunos atuais; `null` para id de outra arena e id malformado (sem consultar o banco).
- [ ] **Step 2:** implementar as funções e as duas páginas (título "Alunos da reserva — Reserva 8h–10h · <quadra> · <dia>" e "Alunos que veem este lance — <horário>"; link "Voltar"); o salvar redireciona para a origem com a mensagem.
- [ ] **Step 3:** nas listas, trocar o seletor embutido por: avatares e nomes atuais + link "Editar alunos" / "Atribuir a alunos". A "Nova reserva" continua com o seletor (é um só por página).
- [ ] **Step 4:** `npm run typecheck`, `npm test`; o controller confere na prévia e roda o build.
- [ ] **Step 5: Commit** `perf(web): escolha de alunos em página própria`.

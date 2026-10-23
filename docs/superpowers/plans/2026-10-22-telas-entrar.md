# Telas de entrar: quem está entrando e como voltar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** As três telas de entrar (aluno, dono, super admin) pedem só e-mail e senha e têm o mesmo título "Entrar". Cada uma passa a dizer de quem é o acesso e ganha um link "← Voltar".

**Spec:** `docs/superpowers/specs/2026-10-16-replay-saas-design.md`.

## Global Constraints

- Branch `feat/telas-entrar`, a partir de `main`. `npm test`, `npm run typecheck`.
- O "Voltar" é um link comum (funciona sem JavaScript e quando a pessoa chegou direto pelo QR, sem histórico), com alvo de toque de 48 px.
- pt-BR, WCAG AA, identidade Strukti. Nenhuma mudança de rota, sessão ou formulário.

### Task 1: Títulos e "Voltar" nas telas de entrar (dono: web)

**Files:**
- Create: `app/componentes/voltar.tsx`
- Modify: `app/a/[slug]/entrar/tela.tsx`, `app/a/[slug]/apresentacao.ts` (`destinoVoltarEntrar(slug, reserva)`), `app/entrar/page.tsx`, `app/admin/entrar/page.tsx`, `app/globals.css`
- Test: `tests/a-apresentacao.test.ts`

- [ ] **Step 1: Teste que falha:** `destinoVoltarEntrar(slug, null)` → `/`; com reserva → `/a/<slug>`; slug fora do formato vai para `/`.
- [ ] **Step 2:** implementar e aplicar:
  - Aluno: "Área do aluno · <arena>", título "Entrar como aluno", dica "Use o e-mail e a senha que a arena te passou."; Voltar → `destinoVoltarEntrar`.
  - Dono: "Painel do dono", título "Entrar como dono da arena", dica "Acesso de quem administra a arena. Aluno entra pela página da arena."; Voltar → `/`.
  - Super admin: "Administração Strukti", título "Entrar como administrador"; Voltar → `/`.
- [ ] **Step 3:** `npm run typecheck`, `npm test`.
- [ ] **Step 4: Commit** `feat(web): telas de entrar dizem quem entra e têm "Voltar"`.

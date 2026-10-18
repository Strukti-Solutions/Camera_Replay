# Várias arenas: escolha da arena e super admin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Replay vira SaaS de verdade: o aluno escolhe a arena antes de entrar, e a equipe Strukti tem um painel de super admin para criar arenas com o dono, ver todas e suspender ou reativar.

**Architecture:** Os dados já são isolados por `arena_id` em todas as tabelas. Entram: uma tabela `super_admins` com sessão própria (tabela e cookie separados dos de dono e aluno); a lista pública (só nome e slug das arenas ativas) em `app/lib/arenas-publicas.ts`, fora da guarda, e as funções de administração em `app/lib/plataforma.ts`, que só `app/admin/**` (e os CLIs de `db/`) importam, atrás da sessão de super admin (`tests/isolamento-plataforma.test.ts` confere); uma página pública `/` que lista as arenas ativas e leva a `/a/<slug>`; e o estado `arenas.status_assinatura` (já existe) passa a valer: arena `suspensa` não aceita login de dono nem de aluno, some da lista e o botão não grava aperto.

**Tech Stack:** o mesmo (Next.js 15, Postgres, Vitest + PGlite).

**Spec:** `docs/superpowers/specs/2026-10-16-replay-saas-design.md`. Planos anteriores: `2026-10-17-web.md`, `2026-10-17-qr-geral.md`.

## Decisões do dono (17/10)

- SaaS com várias arenas no mesmo sistema; o aluno escolhe em qual arena entra.
- Super admin para a equipe criar o sistema de uma arena nova.

## Decisões deste plano (o dono revisa)

- `/` lista as arenas **ativas** com busca por nome (o nome da arena é público); cada uma leva a `/a/<slug>`. Quem tem sessão de dono continua indo ao painel por `/entrar`.
- Primeiro super admin por `npm run criar-super-admin -- --email <email>` (senha pelo terminal, como `criar-dono`); os demais são criados no `/admin`.
- Super admin não entra no painel de uma arena na v1 (sem "entrar como").
- Arena `suspensa`: some de `/`; login de dono e de aluno recusado com "Esta arena está suspensa. Fale com a Strukti."; `registrar_aperto` não grava (token do botão responde como inválido); nada é apagado; reativar devolve tudo.

## Global Constraints

- Branch `feat/multi-arena`, a partir de `feat/qr-geral` (ou da `main`, se ela já tiver o QR geral). `npm test`, `npm run typecheck`; build pelo controller.
- Migrações anteriores não são editadas; a nova é `0009_super_admin.sql`.
- As funções que cruzam arenas ficam só em `app/lib/plataforma.ts` e só são chamadas por páginas e actions de `/admin` depois de `exigirSuperAdmin()`. Nenhuma página de dono ou aluno importa esse módulo.
- Sessão de super admin: tabela `sessoes_admin`, cookie `replay_admin` (HttpOnly, Secure em produção, SameSite Strict, 12 h), limite de tentativas com chave `admin:<email>`; nunca vale como sessão de dono ou aluno, nem o contrário.
- Nenhum segredo em log ou HTML; a senha nunca volta para o formulário. pt-BR, WCAG AA, identidade visual Strukti (Tarefa 4 do plano do QR geral).
- Donos de pasta: Tarefa 1 → `backend`; Tarefas 2 e 3 → `web`.

## Review Focus

- **Sessão de dono ou aluno tentando abrir `/admin`**: volta para o login do admin, nunca mostra dados.
- **Arena suspensa no meio do dia**: o próximo aperto do botão não grava; dono e alunos logados perdem o acesso na próxima página (a sessão é conferida contra o estado da arena).
- **Super admin cria arena com e-mail de dono já usado**: mensagem clara, nada criado pela metade.
- **Lista pública de arenas**: só nome e link; não mostra quadras, dono, e-mail nem contagens.
- **Força bruta no `/admin`**: mesmo limite do login do dono (5 por e-mail, 20 por IP, 15 min).

---

### Task 1: Super admin, estado da arena e funções de plataforma (dono: backend)

**Files:**
- Create: `db/migrations/0009_super_admin.sql`, `app/lib/plataforma.ts`, `app/lib/sessao-admin.ts`, `db/criar-super-admin.ts`
- Modify: spec (seção nova "Plataforma e super admin"; regra da arena suspensa), `app/lib/sessao.ts` e `app/lib/acesso-aluno.ts` (recusar arena suspensa), `db/migrations` nova função ou ajuste de `registrar_aperto` via `create or replace` na 0009, `package.json` (script)
- Test: `tests/plataforma.test.ts`, `tests/sessao-admin.test.ts`, `tests/aperto.test.ts`, `tests/sessao.test.ts`, `tests/acesso-aluno.test.ts`

**Interfaces:**
- SQL: `super_admins (id uuid pk, email text unique check (email = lower(email)), senha_hash text, criado_em)`; `sessoes_admin (id, admin_id fk on delete cascade, token_hash unique, criado_em, expira_em)`; `arenas.status_assinatura` com check `in ('ativa', 'suspensa')` (normalizar valores existentes para `ativa`); `registrar_aperto` não grava em arena suspensa (devolve vazio, como token inválido).
- `sessao-admin.ts`: `entrarAdmin(db, email, senha, ip)`, `validarSessaoAdmin(db, token) → { adminId, email } | null`, `sairAdmin(db, token)` — mesmo desenho de `sessao.ts` (insert-first, chave `admin:<email>`, hash falso), sessão de 12 h.
- `plataforma.ts`: `listarArenasPublicas(db, busca?) → { nome, slug }[]` (só ativas, ordem por nome, até 50); `listarArenasAdmin(db) → { id, nome, slug, status, quadras, alunos, donoEmail, criadoEm }[]`; `criarArenaAdmin(db, { arena, email, senha })` (reusa `criarArenaComDono`); `definirStatusArena(db, arenaId, status) → boolean`; `criarSuperAdmin(db, { email, senha })` (senha ≥ 12).
- `entrar` (dono) e `entrarAluno` recusam arena suspensa com `motivo: "suspensa"`; `validarSessao` e `validarSessaoAluno` devolvem `null` se a arena foi suspensa depois do login.
- CLI `npm run criar-super-admin -- --email <email>`.

- [ ] **Step 1: Spec.** **Step 2: Testes que falham** (cada item do Review Focus que é de backend, mais: sessão de admin não vale como de dono/aluno e vice-versa; `listarArenasPublicas` não traz suspensas nem campos além de nome e slug; suspender corta sessões já abertas na próxima validação; aperto em arena suspensa não cria clipe; reativar volta a gravar). **Step 3:** falha. **Step 4:** implementar. **Step 5:** `npm test`, `npm run typecheck`.
- [ ] **Step 6: Commit** `feat(plataforma): super admin e arenas suspensas`.

### Task 2: Painel do super admin em /admin (dono: web)

- [ ] `/admin/entrar` (e-mail, senha; mensagens iguais às do dono), `/admin` com `exigirSuperAdmin()` em toda página e action: tabela de arenas no estilo do painel (nome, status, quadras, alunos, e-mail do dono, criada em), "Nova arena" (nome da arena, e-mail e senha do dono), "Suspender"/"Reativar" com confirmação, "Novo super admin" (e-mail, senha), "Sair". `noindex` em tudo. Marca Strukti no cabeçalho com o rótulo "Administração".
- [ ] `npm run typecheck`, `npm test`; o controller confere na prévia. **Commit** `feat(web): painel do super admin`.

### Task 3: Escolha da arena e arena suspensa nas telas (dono: web)

- [ ] `/` vira a página "Escolha sua arena": campo de busca (funciona sem JavaScript, por `?busca=`) e lista de arenas ativas com link para `/a/<slug>`; sem resultados: "Nenhuma arena encontrada."; link discreto "Sou dono de arena" para `/entrar`.
- [ ] Login do dono e do aluno mostram "Esta arena está suspensa. Fale com a Strukti." quando for o caso; `/a/<slug>` de arena suspensa mostra a mesma mensagem, sem formulário.
- [ ] `npm run typecheck`, `npm test`; o controller confere na prévia e roda o build. **Commit** `feat(web): escolha da arena e aviso de arena suspensa`.

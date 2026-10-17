# Onde paramos — 16/10/2026

## Feito
- Spec do SaaS de replay: `docs/superpowers/specs/2026-10-16-replay-saas-design.md`.
- Plano 1, worker de captura: `docs/superpowers/plans/2026-10-16-worker-captura.md`. As 8 tarefas foram implementadas com TDD e revisadas uma a uma, depois passaram por uma revisão final da branch e por uma rodada de QA. Resultado: `cd worker && py -m pytest -q` dá 104 passed e 3 skipped (os testes do mux, sem ffmpeg).
- Dívida e bloqueios de produção do worker: `docs/divida-worker.md`.
- Plano 2, backend: `docs/superpowers/plans/2026-10-16-backend.md`, na branch `feat/backend`. As tarefas 1 a 10 (com 3b e 5b) foram implementadas com TDD e aprovadas pela revisão, uma a uma. Resultado: `npm test` dá 106 passed e `npm run typecheck` passa.
  - Schema com isolamento por arena via FKs compostas; câmera presa à quadra (`0003_camera_fixa.sql`).
  - `registrar_aperto` com dedupe de 5 s e rota `POST /api/botao/aperto`.
  - Fila do worker em SQL: `pegar_clipes` (com `arena_id`), `marcar_pronto` (valida a chave, SQLSTATE 22023), `marcar_falhou`, `expirar_presos`.
  - Cliente R2, limpeza de expirados com rota de cron, lista pública da quadra e cifra das credenciais (AES-256-GCM, formato v1).
- Decisões do dono registradas no spec: `arena_id` no contrato da fila; câmera não muda de quadra (reconfiguração manual por nós).
- `main` criada localmente a partir de `feat/worker-captura`. **Nenhum push foi feito.**

## Pendências do backend (detalhe no "Ao terminar" do plano 2)
- Deploy: `vercel.json` com `crons` para `/api/cron/limpeza`, `maxDuration`, `max` do pool ou URL de pooler, variáveis `CRON_SECRET`, `R2_*`, `CAMERA_CRED_KEY`. A `0002` fica congelada antes do primeiro deploy.
- Testes de concorrência real (dedupe e `SKIP LOCKED`) contra Postgres de verdade; o PGlite tem conexão única.
- Flake do PGlite (`Aborted()` no `close()` sob carga), raro.
- Achados menores da última revisão, ainda sem tarefa: `clipes.camera_id` pode ser trocado direto no banco (incluir na regra da câmera fixa); no fluxo manual, a câmera antiga continua ativa com o mesmo `sn` (definir se é apagada ou se o worker ignora `sn` duplicado); o banco não tem teto de 64 para o slug.
- Commits do backend: parte usa `Co-Authored-By: Claude Sonnet 5.5` (modelo que rodou o agente), parte `Opus 5.5`. Decidir se padroniza antes do push.

## Próximos passos
1. Push de `main`, `feat/worker-captura` e `feat/backend` para `origin` (Strukti-Solutions/Camera_Replay), com o ok do dono.
2. Validar na câmera real, seguindo `docs/validacao-camera.md`. Precisa do `worker/cameras.json` (formato de `cameras.example.json`) com as credenciais e do ffmpeg (`winget install Gyan.FFmpeg`). É o maior risco em aberto.
3. Loop de produção do worker (dono `captura`): `PgJobQueue` sobre as funções SQL, `R2Uploader`, apagar o objeto no R2 quando `marcar_pronto` devolve `false`, savepoint em volta do `marcar_pronto` (o erro 22023 aborta a transação), decifrar credenciais (`cifra || tag`), latência do relay, fps por câmera, relógio único e Dockerfile.
4. Plano 3, Web: site do jogador (`/q/<slug>`, usa `clipesDaQuadra`) e painel do dono (sem troca de câmera de quadra).

## Time no Maestri (workspace "goToguether", terminais com `--dir C:\Codes\Camera_Replay`)
- Vigia (Revisor Replay, Opus), Lupa (QA Replay), Prancheta (Backlog Replay, dona da nota `backlog-replay`), Trilho (Dev Captura, standby).
- Os agentes de subprojeto ficam em `.claude/agents/`: captura, backend, web, revisao.

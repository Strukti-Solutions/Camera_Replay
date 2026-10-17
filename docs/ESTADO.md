# Onde paramos — 16/10/2026

## Feito
- Spec do SaaS de replay: `docs/superpowers/specs/2026-10-16-replay-saas-design.md`.
- Plano 1, worker de captura: `docs/superpowers/plans/2026-10-16-worker-captura.md`. As 8 tarefas foram implementadas com TDD e revisadas uma a uma, depois passaram por uma revisão final da branch e por uma rodada de QA. Resultado: `cd worker && py -m pytest -q` dá 95 passed e 3 skipped (os testes do mux, sem ffmpeg).
- Dívida e bloqueios de produção: `docs/divida-worker.md`.
- `main` criada localmente a partir de `feat/worker-captura`. **O push ainda não foi feito.**

## Próximos passos
1. Fazer o push de `main` e `feat/worker-captura` para `origin` (Strukti-Solutions/Camera_Replay).
2. Validar na câmera real, seguindo `docs/validacao-camera.md`. Precisa do `config.py` com as credenciais e do ffmpeg (`winget install Gyan.FFmpeg`). É o maior risco em aberto.
3. Plano 2, Backend: schema Postgres com `arena_id` em tudo, API `POST /api/botao/aperto`, `JobQueue` real (claim com `FOR UPDATE SKIP LOCKED`, reaper de clipes presos), `Uploader` R2, limpeza de expirados e aperto duplo (< 5 s).
4. Loop de produção do worker: polling da fila, latência do relay, fps por câmera, relógio único (NTP ou `now()` do banco) e Dockerfile. Depende do Backend e da escolha do host.
5. Plano 3, Web: site do jogador (`/q/<slug>`) e painel do dono.

## Pequenos ajustes ainda não registrados na dívida (re-revisão final)
- `docs/divida-worker.md`: retirar o item "SN não-hasheável", já resolvido pela validação de `sn`.
- Imports repetidos dentro das funções em `test_config.py` e `test_xm_wire.py`.
- `wire.py`: agrupar as constantes antes da classe `StreamDesyncError`.
- `config.py`: campos só com espaços passam, e o `sn` é guardado sem `strip`.
- `clipper.py`: "após 1 tentativas" (plural errado).
- Falta teste de borda do `max_stale` (30 s contra 31 s).

## Time no Maestri (workspace "goToguether", terminais com `--dir C:\Codes\Camera_Replay`)
- Vigia (Revisor Replay, Opus), Lupa (QA Replay), Prancheta (Backlog Replay, dona da nota `backlog-replay`), Trilho (Dev Captura, standby).
- Os agentes de subprojeto ficam em `.claude/agents/`: captura, backend, web, revisao.

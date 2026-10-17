# Onde paramos — 17/10/2026

## Feito
- Planos 1 a 3 (worker de captura, backend, worker em produção) já integrados na `main`, antes desta rodada.
- Plano web (`docs/superpowers/plans/2026-10-17-web.md`) concluído na `feat/web`, **sem push**:
  - Painel do dono: login (com limite de tentativas por conta), quadras, câmera com credenciais cifradas, botões com token mostrado uma única vez, clipes e QR para imprimir.
  - Alunos e reservas (migrações 0005 e 0006).
  - Página do jogador `/q/<slug>`: lista as reservas (só primeiros nomes, com cadeado), login do aluno e carrossel coverflow por reserva; "meus lances avulsos"; capa `.jpg` por clipe gerada pelo worker e link de download assinado.
  - `npm test` com 245 passando; typecheck e build ok.
- Conferido em preview ao vivo (Postgres local no Docker): login do dono mantém o e-mail após erro; quadra, câmera, botão, aperto 202 e revogação; contagem de lances do aluno com `[inicio, fim)`; login do aluno abre a própria reserva; reserva de outro mostra "Esta reserva não é sua."; o dono atribui um clipe e o aluno o vê em "Meus lances avulsos".
- Bancada com câmera real (uma câmera, a que o dono liberou; as outras duas ficaram de fora a pedido): relay online, 10 fps, 0,14 Mbps, keyframe a cada ~4 s, anel de 0,7 MB em 40 s, clipe de 31,6 s, MP4 1080p decodifica sem erro, capa gerada. Valores no quadro de `docs/validacao-camera.md`. Testes do worker com ffmpeg real (Docker): 182 passed; integração com Postgres passou.

## Pendências
- Medir ainda: latência do relay (`RELAY_LAG_S`), sessão longa e concorrência com o app iCSee.
- O dono aprovar: textos de interface escritos além dos briefs, o aviso da folha do QR e a decisão de que só aluno com reserva vê clipes.
- Antes do deploy: smoke test do link de download no R2 (`response-content-disposition`); variáveis na Vercel (`DATABASE_URL`, `R2_*`, `CAMERA_CRED_KEY`, `CRON_SECRET`, `APP_URL`); `x-real-ip` na Vercel; `npm run migrar` no banco de produção; TLS e DNS rebinding em `xm/`; escolher o host do worker.
- Dívida conhecida: `docs/divida-worker.md`; corrida de sobreposição de reservas (constraint de exclusão com `btree_gist` depois); `atribuirClipe` concorrente pode juntar as duas listas.

## Próximos passos
1. Push de `main`, `feat/backend`, `feat/worker-producao` e `feat/web` para `origin`, com o ok do dono.
2. Fechar as medições pendentes na câmera real.
3. Deploy (Vercel e host do worker) depois da lista "Antes do deploy".

## Time no Maestri (workspace "goToguether", terminais com `--dir C:\Codes\Camera_Replay`)
- Vigia (Revisor Replay, Opus), Lupa (QA Replay), Prancheta (Backlog Replay, dona da nota `backlog-replay`), Trilho (Dev Captura, standby).
- Os agentes de subprojeto ficam em `.claude/agents/`: captura, backend, web, revisao.

---
name: backend
description: Dono do backend (Postgres, API do botão, fila de clipes, R2, limpeza de expirados, isolamento entre arenas). Use para tarefas de banco, API e armazenamento.
model: sonnet
---

Você é o agente **Backend** do Camera_Replay. Leia `CLAUDE.md` e o spec antes de começar.

- Toda tabela filha carrega `arena_id` e toda consulta filtra por ele (isolamento entre arenas).
- Token do botão: só o hash vai para o banco. Credenciais de câmera: cifradas.
- O app e o worker se falam pelo Postgres (fila de clipes `pendente`), nunca por HTTP direto.
- O aperto grava o instante do servidor (`recebido_em`). Aperto duplo (< 5 s no mesmo botão) vira um só.
- Bucket R2 privado; URLs assinadas e curtas. Dependências novas respeitam a quarentena de 7 dias do npm.
- TDD. Commits pequenos.

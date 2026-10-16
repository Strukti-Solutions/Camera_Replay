# Camera_Replay

SaaS de replay para quadras: o jogador aperta um botão e os últimos 30 s da câmera ficam disponíveis numa página aberta por QR code. Idioma de trabalho: português.

- **Fonte da verdade:** `docs/superpowers/specs/2026-10-16-replay-saas-design.md`. Planos em `docs/superpowers/plans/`. Em conflito, o spec vale mais que o plano.
- **Código de origem (somente leitura):** `C:/Codes/strukti-site/camera/src/` (cliente Xiongmai/iCSee) e `C:/Codes/strukti-site/src/lib/bancada/` (envio ao R2). Portar para cá, nunca editar lá.
- **Segredos:** `cameras.json`, `.env` e qualquer credencial de câmera nunca vão para o git.
- **Python:** no Git Bash desta máquina o comando é `py` (não `python`). Testes: `cd worker && py -m pytest`.

## Time de agentes (`.claude/agents/`)

| Agente | Frente | Pasta que é dono |
|---|---|---|
| `captura` | worker Python: anel, corte, relay, reconexão | `worker/` |
| `backend` | schema Postgres, API do botão, fila, R2, limpeza | `app/api`, `app/lib`, `db/` |
| `web` | site do jogador (`/q/<slug>`) e painel do dono | `app/` (páginas e componentes) |
| `revisao` | revisa cada entrega e confere segurança | somente leitura |

Cada agente só mexe na própria pasta. Mudança de contrato entre frentes (tabela, formato de fila, API) passa pelo spec antes.

## Regras de entrega

1. Tarefa pequena com critério de aceite, escrita no plano.
2. Teste primeiro (TDD), depois a implementação mínima.
3. Commits em Conventional Commits, `git add` explícito, com a linha `Co-Authored-By`.
4. A revisão aprova antes da próxima tarefa. Push e deploy só com o ok do dono do projeto.

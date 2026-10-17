# Camera_Replay

SaaS de replay para quadras: o jogador aperta um botão e recebe os últimos 30 s da câmera.

- Spec: `docs/superpowers/specs/2026-10-16-replay-saas-design.md`
- Planos: `docs/superpowers/plans/`
- `worker/`: worker de captura (Python). Testes: `cd worker && py -m pytest`.

## Worker de captura

Roda 24 h: lê as câmeras do banco, mantém o anel de vídeo de cada uma e corta os clipes pedidos pela fila do Postgres, enviando o mp4 ao R2.

Variáveis de ambiente (obrigatórias): `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CAMERA_CRED_KEY`. Opcionais: `RELAY_LAG_S` (padrão `0`) e `WORKER_POLL_S` (padrão `1`). Se faltar alguma obrigatória, o worker imprime só os nomes e sai com código 2.

Local (precisa de `ffmpeg` no PATH):

```bash
cd worker
py -m pip install "psycopg[binary]==3.3.6" "cryptography==50.0.2"
# defina as variáveis acima no ambiente e rode:
py -m replay_worker.main
```

Docker:

```bash
docker build -t replay-worker worker/
docker run --rm --env-file worker/.env replay-worker
```

O `.env` não vai para o git nem para a imagem. Sem variáveis, o contêiner sai com a lista do que falta.

# Dívida do worker de captura

## Bloqueia produção

- **TLS sem verificação** em `xm/cloud.py`: um MITM lê o AuthCode. Ligar a verificação ou fazer pinning.
- **DNS rebinding** em `_check_remote`: um host `*.secu100.net` pode resolver para IP privado.
- **ffmpeg nunca executado de verdade**: instalar e rodar `tests/test_mux.py`.
- **Validação na câmera real**: ver `docs/validacao-camera.md`.
- **Latência do relay e fps por câmera** no loop de produção.
- **Relógio único**: `pressed_at` vem do Postgres e o anel usa `time.time()` do worker. Usar NTP no worker ou `now()` do banco.

## Dívida (não bloqueia)

### h264.py
- Faltam testes de start code de 4 bytes fora do offset 0, start code truncado no fim e bit proibido no meio.
- SEI (tipo 6) após uma fatia fica no quadro anterior (validar no smoke).

### ring.py
- Um quadro maior que `max_bytes` passa do teto.
- O aparo assume tempo monotônico.
- Faltam testes: aparo por bytes descartando keyframe, `end_t` antes de todos, concorrência, keyframe exato em `want_start`.
- Faltam docstrings nas classes.

### mux.py
- Teste de ftyp fraco (sem moov/duração).
- O teste de 30 quadros pertence a h264 e regenera a amostra.
- Literal 60 repetido.
- stderr cortado no início.

### xm/
- A docstring de `connect_live` diz só RelayError.
- `wait(1414)` é ignorado.
- UserName sem escape JSON.
- `find_last_marker` é O(n) por pacote.
- `dewrap` ignora o tamanho do cabeçalho XM (usar tamanhos fixos FC/FE=16, FD=8 após validar).
- `cloud.py` põe `raw[:80]` da resposta na exceção.
- `_HOST_RE` sem `re.ASCII`.
- IPv6 sem colchetes na URL.

### capture.py / source.py / config.py
- `_last_video` é marcado sem AU.
- `last_error` nunca é limpo.
- Sessão curta em laço reconecta a cada 1 s.
- `FileSource.chunks` antes de `open` / fps <= 0.
- `RelaySource.close` só captura OSError.
- `stop` com fluxo mudo leva até 15 s (`read_timeout`).

### clipper.py / local.py
- `LocalDirUploader` sem proteção a path traversal e sem escrita atômica.
- `MemoryQueue` sem lock (o claim real precisa ser atômico: `FOR UPDATE SKIP LOCKED`).
- Retry sem backoff nem log por tentativa.
- `mark_ready` falhando após o upload deixa objeto órfão no R2 (lifecycle do bucket).

### smoke.py
- `--wait` atrasa até 5 s.
- Sem try/finally + join no stop.
- Intervalo de keyframe enganoso com 1 keyframe.
- `--cameras` inválido gera traceback cru.

### spec
- O clipe vai de 30 s até 30 s + GOP (não 30-32 s) enquanto o GOP da câmera não for ~2 s.

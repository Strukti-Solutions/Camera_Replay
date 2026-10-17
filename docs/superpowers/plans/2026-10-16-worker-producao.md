# Worker em produção: fila do Postgres, envio ao R2 e loop 24 h

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O worker Python roda sozinho 24 h: lê do Postgres as câmeras ativas, mantém uma captura por câmera, pega os clipes pendentes pela fila SQL, envia o MP4 ao R2 com a chave do contrato e informa o status de cada câmera.

**Architecture:** As peças do plano 1 (`Ring`, `CameraCapture`, `process_job`) não mudam de papel. Entram implementações reais atrás dos `Protocol`s que já existem: `PgJobQueue` chama as funções SQL do contrato da fila e `R2Uploader` assina PUT e DELETE em SigV4 com a biblioteca padrão. Um `Supervisor` em `main.py` liga tudo: atualiza a lista de câmeras, sobe e derruba capturas, consulta a fila e processa os clipes. O relógio do banco é a referência: o worker mede a diferença para o seu relógio e converte o instante do aperto antes de cortar.

**Tech Stack:** Python >= 3.11, `psycopg[binary]` 3 (Postgres), `cryptography` (AES-GCM), pytest, ffmpeg externo, Docker.

**Spec:** `docs/superpowers/specs/2026-10-16-replay-saas-design.md`. Planos anteriores: `2026-10-16-worker-captura.md` (peças do worker) e `2026-10-16-backend.md` (contrato SQL, R2 e formato das credenciais).

## Global Constraints

- Python >= 3.11; no Git Bash desta máquina use `py`. Testes do worker: `cd worker && py -m pytest -q`. Testes do app: `npm test` na raiz.
- Dependências de pip novas: só `psycopg[binary]` e `cryptography`, com versão **exata** em `worker/pyproject.toml`, publicada há pelo menos **7 dias** (conferir a data em `https://pypi.org/pypi/<pacote>/json`). Nada de boto3: o SigV4 usa `hmac`/`hashlib`/`urllib`.
- App e worker só se falam pelo Postgres, pelas funções do contrato. O worker nunca faz `insert`/`update` direto em tabelas.
- Chave no R2: `clipes/<arena_id>/<clipe_id>.mp4`, exatamente (a `marcar_pronto` recusa outra com SQLSTATE 22023).
- Credenciais da câmera: `v1:<iv>:<tag>:<cifra>` em base64, AES-256-GCM, a `<cifra>` não inclui a tag (na `cryptography`, decifrar `cifra || tag`). Chave: `CAMERA_CRED_KEY`, base64 canônico de 32 bytes.
- Anel de 40 s, clipe de 30 s, backoff de 1, 2, 4… até 60 s, câmera `offline` após 30 s sem vídeo, pedido com mais de 120 s vira `falhou`, 3 tentativas de envio.
- Variáveis de ambiente do worker: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CAMERA_CRED_KEY`, e opcionais `RELAY_LAG_S` (padrão `0`) e `WORKER_POLL_S` (padrão `1`).
- Nenhum segredo em log, exceção ou `repr`: nem credencial, nem `DATABASE_URL`, nem chave do R2. Logs citam câmera e clipe pelo id.
- Comentários em português. Conventional Commits, `git add` explícito, linha final `Co-Authored-By` com o modelo que escreveu o commit.
- Branch `feat/worker-producao`, criada a partir de `feat/backend`.

## Review Focus

- **O Postgres cai com o worker rodando** (rede, reinício do banco): as capturas continuam enchendo os anéis, o loop reconecta na próxima volta e nenhum pedido se perde (os presos o reaper resolve). (Tarefa 5 e Tarefa 6)
- **O relógio do worker está alguns segundos fora do banco**: o corte acontece no instante do aperto medido pelo banco, não pelo worker. (Tarefa 5)
- **O reaper marca o clipe como `falhou` enquanto o worker envia**: `marcar_pronto` devolve `false` e o worker apaga o objeto que acabou de mandar ao R2. (Tarefa 2)
- **Câmera entra ou sai da lista com o worker rodando** (botão revogado, câmera nova): a captura sobe ou para na próxima atualização, sem reiniciar o worker. (Tarefa 6)
- **Credencial que não decifra** (chave errada, texto adulterado): aquela câmera fica de fora com log só do id, e as outras seguem. (Tarefa 6)

---

## Fora deste plano

- TLS sem verificação em `xm/cloud.py` e DNS rebinding em `_check_remote` (`docs/divida-worker.md`, "Bloqueia produção"). Dependem de ver o certificado e os hosts reais na validação da câmera. Ficam como bloqueio de deploy.
- Escolha do host e o deploy em si. Este plano entrega a imagem Docker, não a publica.
- Valor real de `RELAY_LAG_S` e do fps: medidos na validação da câmera (`docs/validacao-camera.md`).

## File Structure

```
db/migrations/0004_worker.sql          # listar_cameras, marcar_camera (dono: backend)
tests/worker-contrato.test.ts          # testes das duas funções (dono: backend)
worker/
  pyproject.toml                       # + psycopg[binary], cryptography
  Dockerfile, .dockerignore
  replay_worker/
    clipper.py                         # ClipJob com arena_id, chave do contrato, órfão, fps do anel
    local.py                           # MemoryQueue e LocalDirUploader no protocolo novo
    creds.py                           # decifrar_credenciais (v1)
    r2.py                              # R2Uploader: PUT e DELETE assinados
    pg.py                              # PgJobQueue, ClockSync, Camera, listar e status
    main.py                            # Supervisor e ponto de entrada
  tests/
    test_clipper.py, test_local.py     # ajustados
    test_creds.py, test_r2.py, test_pg.py, test_main.py
```

---

### Task 1: Contrato do worker no spec e funções SQL (dono: backend)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-replay-saas-design.md` (seção "Contrato da fila")
- Create: `db/migrations/0004_worker.sql`
- Test: `tests/worker-contrato.test.ts`

**Interfaces:**
- Produces (SQL):
  - `listar_cameras() returns table (camera_id uuid, arena_id uuid, sn text, credenciais text)`. Só câmeras com pelo menos um botão não revogado (`botoes.revogado_em is null`). Isso resolve a câmera antiga do fluxo manual: o botão foi religado à câmera nova, então a antiga sai da lista e o mesmo `sn` não abre duas conexões.
  - `marcar_camera(p_camera_id uuid, p_status text) returns boolean`. Grava `status`; com `'online'` grava também `visto_em = now()`. Devolve `false` se a câmera não existe. Status fora de `online`/`offline` é recusado pelo check da tabela.

- [ ] **Step 1: Spec.** Acrescentar as duas funções ao "Contrato da fila", com a regra do botão ativo e uma linha: o worker usa `clock_timestamp()` do banco como relógio de referência.
- [ ] **Step 2: Testes que falham** (`tests/worker-contrato.test.ts`):
  - câmera com botão ativo aparece, com `arena_id`, `sn` e `credenciais` certos;
  - câmera sem botão, ou só com botão revogado, não aparece;
  - fluxo manual: câmera nova na mesma quadra, `update botoes set camera_id = <nova>` → só a nova aparece;
  - duas arenas: as duas câmeras aparecem, cada uma com o seu `arena_id`;
  - `marcar_camera(id, 'online')` grava status e `visto_em` recente; `'offline'` não mexe em `visto_em`; id inexistente → `false`; `'xyz'` → erro.
- [ ] **Step 3:** `npm test -- tests/worker-contrato.test.ts` falha.
- [ ] **Step 4:** Implementar `0004_worker.sql` (nova migração; a 0001 a 0003 não mudam).
- [ ] **Step 5:** `npm test` e `npm run typecheck` passam.
- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-16-replay-saas-design.md db/migrations/0004_worker.sql tests/worker-contrato.test.ts
git commit -m "feat(db): listar_cameras e marcar_camera para o worker"
```

---

### Task 2: Clipper no contrato real (chave, órfão, fps)

**Files:**
- Modify: `worker/replay_worker/clipper.py`, `worker/replay_worker/local.py`, `worker/replay_worker/smoke.py`
- Test: `worker/tests/test_clipper.py`, `worker/tests/test_local.py` (novo), `worker/tests/qa/test_bordas.py` (ajustar chamadas)

**Interfaces:**
- Produces:
  - `ClipJob(clip_id: str, camera_id: str, arena_id: str, pressed_at: float)`. `pressed_at` já no relógio do worker (quem converte é a fila).
  - `chave_do_clipe(job: ClipJob) -> str` → `"clipes/%s/%s.mp4" % (arena_id, clip_id)`.
  - `JobQueue.mark_ready(clip_id, key, size, duration, partial) -> bool` (antes `None`). `claim_pending` e `mark_failed` iguais.
  - `Uploader.put(key: str, data: bytes) -> None` e `Uploader.delete(key: str) -> None` (substituem `upload(clip_id, mp4) -> str`).
  - `process_job(job, ring, queue, uploader, fps: float | None = None, ...)`: com `fps=None`, usa `round(ring.stats().fps)` limitado a 1..60, e 15 se o anel não tiver medida.
  - `LocalDirUploader.put/delete`: a chave vira caminho relativo dentro da pasta; chave absoluta, com `..` ou que resolva fora da pasta lança `ValueError`; escrita atômica (arquivo temporário + `os.replace`).

- [ ] **Step 1: Testes que falham:**
  - a chave enviada é `clipes/<arena_id>/<clip_id>.mp4` e é a mesma passada a `mark_ready`;
  - `mark_ready` devolve `False` → `uploader.delete(key)` é chamado uma vez e `process_job` devolve `False`; se o `delete` lançar, `process_job` continua sem lançar e loga só o id;
  - `fps=None` com anel a ~14,7 fps → o mux recebe 15; anel sem medida → 15;
  - `LocalDirUploader`: `put("clipes/a/b.mp4")` grava em `<dir>/clipes/a/b.mp4`; `"../x.mp4"`, `"/x.mp4"` e `"clipes/../../x.mp4"` lançam `ValueError`; `delete` de chave inexistente não lança.
- [ ] **Step 2:** `py -m pytest -q` falha nos novos.
- [ ] **Step 3:** Implementar. `MemoryQueue.mark_ready` devolve `True`. O `smoke.py` passa a criar `ClipJob` com `arena_id="smoke"`.
- [ ] **Step 4:** `py -m pytest -q` passa (todos, inclusive os do plano 1 ajustados).
- [ ] **Step 5: Commit**

```bash
git add worker/replay_worker/clipper.py worker/replay_worker/local.py worker/replay_worker/smoke.py worker/tests/test_clipper.py worker/tests/test_local.py worker/tests/qa/test_bordas.py
git commit -m "feat(worker): chave do contrato, órfão apagado quando o reaper vence e fps do anel"
```

---

### Task 3: Decifrar as credenciais da câmera

**Files:**
- Modify: `worker/pyproject.toml`
- Create: `worker/replay_worker/creds.py`
- Test: `worker/tests/test_creds.py`

**Interfaces:**
- Produces:
  - `ler_chave(b64: str) -> bytes`: base64 canônico (sem espaço nem quebra; aplica `strip` antes), exatamente 32 bytes, senão `ValueError("CAMERA_CRED_KEY inválida")`.
  - `decifrar_credenciais(texto: str, chave: bytes, sn: str, nome: str = "") -> CameraCreds`: aceita só `v1`, IV de 12 bytes, tag de 16; JSON com `authcode`, `local_user`, `local_pwd` como string. Qualquer falha lança `ValueError("credencial inválida")`, sem citar o conteúdo.

- [ ] **Step 1: Dependências.** `psycopg[binary]` e `cryptography` com versão exata e data de publicação conferida (registrar as datas na mensagem do commit).
- [ ] **Step 2: Testes que falham:**
  - o vetor `tests/vetor-credenciais.json` da raiz do repo (gerado pelo app) decifra para os três campos esperados. O teste lê o arquivo por caminho relativo ao repo, sem copiar;
  - um byte trocado no IV, na tag ou na cifra → `ValueError`; `v2:` → `ValueError`; chave de 31 bytes → `ValueError`;
  - a mensagem do erro não contém nenhum dos três valores nem a chave.
- [ ] **Step 3:** `py -m pytest tests/test_creds.py -q` falha.
- [ ] **Step 4:** Implementar com `cryptography.hazmat.primitives.ciphers.aead.AESGCM`.
- [ ] **Step 5:** `py -m pytest -q` passa.
- [ ] **Step 6: Commit**

```bash
git add worker/pyproject.toml worker/replay_worker/creds.py worker/tests/test_creds.py
git commit -m "feat(worker): decifra as credenciais v1 com o vetor do app"
```

---

### Task 4: R2Uploader com SigV4 da biblioteca padrão

**Files:**
- Create: `worker/replay_worker/r2.py`
- Test: `worker/tests/test_r2.py`

**Interfaces:**
- Produces: `R2Uploader(account_id, access_key_id, secret_access_key, bucket, opener=urllib.request.urlopen, clock=time.time)` com `put(key, data) -> None` e `delete(key) -> None`, no protocolo `Uploader` da Tarefa 2. Endpoint `https://<account_id>.r2.cloudflarestorage.com/<bucket>/<chave>`, região `auto`, serviço `s3`, cabeçalho `x-amz-content-sha256` com o SHA-256 do corpo. Cada segmento da chave em `urllib.parse.quote(seg, safe="-_.~")`. PUT com `Content-Type: video/mp4`. DELETE aceita 204 e 404. Outros status lançam `R2Error(status)`, sem URL assinada nem segredo na mensagem. `repr` não mostra o segredo.

- [ ] **Step 1: Testes que falham:**
  - a função interna de assinatura reproduz o exemplo oficial da AWS de PUT com assinatura no cabeçalho (bucket `examplebucket`, objeto `test$file.text`, `AKIAIOSFODNN7EXAMPLE`, `20130524T000000Z`, `us-east-1`, corpo `Welcome to Amazon S3.`, cabeçalhos `date: Fri, 24 May 2013 00:00:00 GMT`, `host: examplebucket.s3.amazonaws.com`, `x-amz-content-sha256`, `x-amz-date`, `x-amz-storage-class: REDUCED_REDUNDANCY`) e dá a assinatura `98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd`;
  - `put` com `opener` falso: método PUT, URL e `Authorization` com `Credential=<id>/<dia>/auto/s3/aws4_request`;
  - `delete` com 404 não lança; com 500 lança `R2Error` e a mensagem não tem o segredo;
  - chave com espaço e `#` sai codificada por segmento, com as barras preservadas.
- [ ] **Step 2:** falha. **Step 3:** implementar. **Step 4:** `py -m pytest -q` passa.
- [ ] **Step 5: Commit**

```bash
git add worker/replay_worker/r2.py worker/tests/test_r2.py
git commit -m "feat(worker): envio e remoção no R2 com SigV4 sem dependências"
```

---

### Task 5: Fila do Postgres e relógio do banco

**Files:**
- Create: `worker/replay_worker/pg.py`
- Test: `worker/tests/test_pg.py`

**Interfaces:**
- Consumes: as funções SQL do contrato (backend e Tarefa 1); `ClipJob` e `JobQueue` (Tarefa 2); `decifrar_credenciais` (Tarefa 3).
- Produces:
  - `ClockSync(query_epoch, clock=time.time)`, com `sync() -> None` e `to_local(db_epoch: float) -> float`. `query_epoch()` devolve `extract(epoch from clock_timestamp())` do banco. `sync` mede 3 vezes e guarda o deslocamento da amostra de menor ida e volta: `offset = db - (t0 + t1) / 2`. `to_local(x) = x - offset`.
  - `Camera(camera_id: str, arena_id: str, sn: str, creds: CameraCreds)`.
  - `PgJobQueue(connect, clock_sync: ClockSync, chave: bytes, limite: int = 5)` no protocolo `JobQueue`, mais `listar_cameras() -> list[Camera]`, `marcar_camera(camera_id, status) -> None` e `expirar_presos() -> int`. `connect()` devolve uma conexão psycopg em **autocommit** (cada chamada é a sua transação, então o 22023 de `marcar_pronto` não contamina as seguintes).
  - `claim_pending(camera_id)` chama `pegar_clipes(camera_id, limite)` e devolve `ClipJob` com `pressed_at = clock_sync.to_local(recebido_em.timestamp())`.
  - Erro de conexão (`psycopg.OperationalError`) descarta a conexão; a próxima chamada reconecta. O erro sobe para quem chamou.
  - `listar_cameras` pula a câmera cuja credencial não decifra e loga `"câmera %s: credencial inválida"` só com o id.

- [ ] **Step 1: Testes que falham** (com conexão falsa que grava SQL e parâmetros e devolve linhas prontas):
  - `ClockSync` com banco 7 s à frente e ida e volta de 0,2 s → `to_local(db) == db - 7` (±0,11); escolhe a amostra de menor ida e volta;
  - `claim_pending` chama `select * from pegar_clipes(%s, %s)` com `(camera_id, 5)` e converte `recebido_em` para o relógio local;
  - `mark_ready` chama `marcar_pronto` e devolve o booleano do banco; `mark_failed` chama `marcar_falhou`;
  - `OperationalError` numa chamada: ela lança, e a seguinte abre uma conexão nova (o `connect` falso é chamado 2 vezes);
  - `listar_cameras` com uma credencial boa e uma adulterada → devolve 1 câmera e o log não tem a credencial.
  - Integração opcional, `pytest.mark.skipif(not os.environ.get("DATABASE_URL"))`: contra um Postgres migrado, um clipe criado por `registrar_aperto` passa por `claim_pending` e `mark_ready` com a chave certa.
- [ ] **Step 2:** falha. **Step 3:** implementar. **Step 4:** `py -m pytest -q` passa (a integração é pulada sem `DATABASE_URL`).
- [ ] **Step 5: Commit**

```bash
git add worker/replay_worker/pg.py worker/tests/test_pg.py
git commit -m "feat(worker): fila do Postgres com relógio do banco e reconexão"
```

---

### Task 6: Supervisor e ponto de entrada

**Files:**
- Create: `worker/replay_worker/main.py`
- Test: `worker/tests/test_main.py`

**Interfaces:**
- Consumes: `PgJobQueue`, `Camera` (Tarefa 5), `R2Uploader` (Tarefa 4), `ler_chave` (Tarefa 3), `CameraCapture`, `Ring`, `RelaySource`, `process_job`.
- Produces:
  - `Supervisor(queue, uploader, make_source, clock=time.time, relay_lag: float = 0.0)`, com `refresh() -> None`, `poll_once() -> int` (clipes processados), `report_status() -> None`, `stop() -> None`. `make_source(camera: Camera) -> VideoSource`.
  - `refresh`: sobe uma thread de `CameraCapture.run_forever` (com `Ring()` próprio) para cada câmera nova de `listar_cameras`, e para (`stop` + `join` com timeout) a de cada câmera que saiu.
  - `poll_once`: para cada câmera ativa, `claim_pending` e `process_job` (com `fps=None`). Um job com `clock() < pressed_at + relay_lag` espera dentro da mesma chamada até esse instante, no máximo 10 s. Exceção da fila numa câmera não impede as outras.
  - `report_status`: `marcar_camera(id, capture.status)` para cada câmera.
  - `main() -> int`: lê o ambiente (Global Constraints), falha com mensagem clara se faltar variável obrigatória (sem imprimir valores), e roda o laço: `refresh` e `ClockSync.sync` a cada 30 s, `report_status` a cada 15 s, `expirar_presos` a cada 60 s, `poll_once` a cada `WORKER_POLL_S`. Exceções de banco no laço são logadas pelo tipo e o laço segue. SIGTERM/SIGINT chamam `stop` e saem com 0. Uso: `py -m replay_worker.main`.

- [ ] **Step 1: Testes que falham** (fila e uploader falsos, `FileSource` sobre um H.264 sintético dos helpers do plano 1, mux falso, relógio controlado):
  - `refresh` com 2 câmeras sobe 2 capturas; com 1, para a outra; com a mesma lista, não recria nada;
  - um clipe pendente vira `put` com `clipes/<arena>/<clipe>.mp4` e `mark_ready`;
  - `relay_lag=2`: um job com `pressed_at = agora` só é cortado depois de o relógio passar de `pressed_at + 2`;
  - a fila lança em `claim_pending` para a câmera A: a câmera B ainda é processada;
  - `report_status` chama `marcar_camera` com `online` para a câmera com vídeo recente e `offline` para a muda;
  - `main()` sem `DATABASE_URL` sai com código diferente de 0, e a mensagem não contém o valor de nenhuma outra variável.
- [ ] **Step 2:** falha. **Step 3:** implementar. **Step 4:** `py -m pytest -q` passa.
- [ ] **Step 5: Commit**

```bash
git add worker/replay_worker/main.py worker/tests/test_main.py
git commit -m "feat(worker): supervisor 24 h com câmeras do banco, fila e status"
```

---

### Task 7: Imagem Docker e documentação

**Files:**
- Create: `worker/Dockerfile`, `worker/.dockerignore`
- Modify: `README.md` (seção do worker), `docs/divida-worker.md` (marcar como resolvidos: relógio único, latência do relay e fps, `MemoryQueue`/`LocalDirUploader`, órfão no R2), `docs/ESTADO.md`

**Interfaces:**
- Produces: imagem a partir de `python:3.12-slim` com `ffmpeg` do apt, usuário sem privilégio, `pip install` só das dependências do `pyproject.toml`, `CMD ["python", "-m", "replay_worker.main"]`, sem porta exposta. O `.dockerignore` exclui `cameras.json`, `out/`, `*.h264`, `.env*`, `tests/` e `__pycache__/`.

- [ ] **Step 1:** Escrever o Dockerfile e o `.dockerignore`.
- [ ] **Step 2:** Se o Docker existir na máquina, `docker build -t replay-worker worker/` e `docker run --rm replay-worker` sem variáveis: tem que sair com a mensagem de variável faltando. Se não existir, registrar no commit que o build não foi verificado.
- [ ] **Step 3:** README: como rodar o worker local (`py -m replay_worker.main` com as variáveis) e com Docker. Atualizar a dívida e o estado.
- [ ] **Step 4:** `py -m pytest -q` e `npm test` passam.
- [ ] **Step 5: Commit**

```bash
git add worker/Dockerfile worker/.dockerignore README.md docs/divida-worker.md docs/ESTADO.md
git commit -m "build(worker): imagem Docker com ffmpeg e documentação do loop"
```

---

## Ao terminar

- Validar na câmera real (`docs/validacao-camera.md`) e preencher `RELAY_LAG_S` com a latência medida.
- Resolver o TLS e o DNS rebinding do `xm/` antes do deploy.
- Escolher o host e publicar a imagem.

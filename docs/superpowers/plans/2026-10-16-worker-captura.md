# Worker de captura: fundação do repo, anel de 30 s e corte do clipe

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um worker Python que mantém uma conexão com cada câmera, guarda os últimos ~40 s de vídeo H.264 em memória e, dado um instante de aperto, corta os 30 s anteriores em um MP4, com reconexão automática.

**Architecture:** O núcleo é puro e testável sem rede: `h264` (separa quadros), `ring` (anel com corte no keyframe), `mux` (`ffmpeg -c copy`). A rede fica atrás da interface `VideoSource` (`RelaySource` para o relay do fabricante, `FileSource` para câmera simulada). `CameraCapture` alimenta o anel com reconexão e backoff. `process_job` corta, converte e envia, falando com a fila e com o armazenamento só por `Protocol`s (as implementações reais de Postgres e R2 vêm no plano do Backend).

**Tech Stack:** Python >= 3.11 (só biblioteca padrão no código de produção), pytest, ffmpeg externo.

**Spec:** `docs/superpowers/specs/2026-10-16-replay-saas-design.md`. Código de origem (somente leitura) em `C:/Codes/strukti-site/camera/src/`.

## Global Constraints

- Python >= 3.11. No Git Bash desta máquina o comando `python` não está no PATH: use `py` (3.14). Rode os testes sempre de dentro de `C:/Codes/Camera_Replay/worker`.
- O código de produção do worker não tem dependências de pip (só biblioteca padrão). `pytest` é a única dependência de desenvolvimento.
- ffmpeg é externo (`winget install Gyan.FFmpeg`). O corte usa `-c copy` (nunca recodifica). Testes que precisam do ffmpeg são pulados se ele não existir.
- Anel de 40 s (`keep_seconds=40.0`); clipe de 30 s (`seconds=30.0`); teto de memória do anel 64 MiB por câmera.
- Os tempos do anel usam o relógio do servidor em segundos desde a época (`time.time()`), o mesmo de `apertos.recebido_em`.
- Reconexão: backoff de 1, 2, 4, 8, 16, 32, 60 s. Câmera `offline` após 30 s sem vídeo. Pedido com mais de 120 s vira `falhou`.
- Segredos nunca entram no git: `cameras.json`, `out/` e `*.h264` ficam no `.gitignore`.
- Comentários e docstrings em português, no estilo de `camera/src/`. Commits em Conventional Commits, com `git add` explícito e a linha final `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Buffer vazio ou só com quadros P** (logo após reconectar): `Ring.cut` devolve `None` e o clipe vira `falhou` com motivo, sem exceção. (Tarefa 3 e Tarefa 7)
- **Aperto antes de haver 30 s no anel** (worker acabou de subir): o clipe sai `parcial`, com a duração real, e não falha. (Tarefa 3)
- **Câmera caiu e voltou perto do aperto** (buraco no meio, ou fluxo morto no instante do aperto): o corte marca `has_gap` e o clipe sai `parcial`. (Tarefa 3)
- **Bytes lixo ou truncados vindos do relay**: `split_access_units` e `dewrap` nunca lançam exceção e devolvem vazio. (Tarefa 2 e Tarefa 5)
- **Bitrate alto**: o anel respeita o teto de bytes e não cresce sem limite. (Tarefa 3)

---

## File Structure

```
Camera_Replay/
  README.md
  .gitignore
  docs/superpowers/{specs,plans}/...
  worker/
    pyproject.toml
    cameras.example.json
    replay_worker/
      __init__.py
      h264.py        # NALs, separação em quadros, detecção de keyframe
      ring.py        # anel de quadros com corte no keyframe
      mux.py         # H.264 -> MP4 via ffmpeg -c copy
      config.py      # carrega cameras.json -> CameraCreds
      source.py      # VideoSource, RelaySource, FileSource
      capture.py     # CameraCapture: alimenta o anel, reconecta
      clipper.py     # ClipJob, JobQueue, Uploader, process_job
      local.py       # MemoryQueue e LocalDirUploader (bancada)
      smoke.py       # CLI de validação com a câmera real
      xm/
        __init__.py
        crypto.py    # xor_crypt, nonce, sofia_hash
        cloud.py     # jftech_post
        wire.py      # netip, NetIPReader, dewrap, video_chunks
        relay.py     # CameraCreds, connect_live
    tests/
      __init__.py
      helpers.py
      test_h264.py  test_ring.py  test_mux.py  test_config.py
      test_xm_crypto.py  test_xm_wire.py  test_source.py
      test_capture.py  test_clipper.py
```

---

### Task 1: Esqueleto do repo

**Files:**
- Create: `README.md`, `.gitignore`, `worker/pyproject.toml`, `worker/cameras.example.json`, `worker/replay_worker/__init__.py`, `worker/replay_worker/xm/__init__.py`, `worker/tests/__init__.py`, `worker/tests/helpers.py`, `worker/tests/test_sanity.py`

**Interfaces:**
- Produces: `tests.helpers.nal(t, body=b"\x11\x22") -> bytes`, `KEY: bytes`, `P: bytes`, `feed(ring, seconds, gop=10, start=0.0)` (1 quadro por segundo; um keyframe a cada `gop` quadros).

- [ ] **Step 1: Criar os arquivos**

`.gitignore`:
```
__pycache__/
.pytest_cache/
*.pyc
.venv/
.env
worker/cameras.json
worker/out/
*.h264
*.mp4
```

`worker/pyproject.toml`:
```toml
[project]
name = "replay-worker"
version = "0.1.0"
description = "Worker de captura do replay: anel de 30 s por câmera e corte do clipe"
requires-python = ">=3.11"
dependencies = []

[project.optional-dependencies]
dev = ["pytest>=8"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

`worker/cameras.example.json`:
```json
{
  "cameras": [
    {
      "sn": "SERIAL_DA_CAMERA",
      "name": "Quadra 1",
      "authcode": "aaaaaaaa-1a0eXXXXX",
      "local_user": "xxxx",
      "local_pwd": "xxxxxx"
    }
  ]
}
```

`worker/replay_worker/__init__.py` e `worker/replay_worker/xm/__init__.py` e `worker/tests/__init__.py`: arquivos vazios.

`worker/tests/helpers.py`:
```python
"""Construtores de H.264 sintético para os testes."""
SC = b"\x00\x00\x00\x01"


def nal(t, body=b"\x11\x22"):
    """Um NAL Annex-B de tipo `t` (7=SPS, 8=PPS, 5=IDR, 1=P)."""
    return SC + bytes([t]) + body


KEY = nal(7) + nal(8) + nal(5)   # um quadro-chave completo
P = nal(1)                       # um quadro P


def feed(ring, seconds, gop=10, start=0.0):
    """Alimenta o anel com 1 quadro por segundo; keyframe a cada `gop` quadros."""
    for i in range(int(seconds)):
        ring.append(start + i, KEY if i % gop == 0 else P)
```

`worker/tests/test_sanity.py`:
```python
def test_pytest_roda():
    assert True
```

`README.md`:
```markdown
# Camera_Replay

SaaS de replay para quadras: o jogador aperta um botão e recebe os últimos 30 s da câmera.

- Spec: `docs/superpowers/specs/2026-10-16-replay-saas-design.md`
- Planos: `docs/superpowers/plans/`
- `worker/`: worker de captura (Python). Testes: `cd worker && py -m pytest`.
```

- [ ] **Step 2: Instalar pytest e rodar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pip install pytest && py -m pytest -v`
Expected: `1 passed`

- [ ] **Step 3: Commit**

```bash
cd C:/Codes/Camera_Replay
git add README.md .gitignore docs worker
git commit -m "chore: esqueleto do repo, spec e plano do worker

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `h264.py` — NALs, quadros e keyframes

**Files:**
- Create: `worker/replay_worker/h264.py`
- Test: `worker/tests/test_h264.py`

**Interfaces:**
- Produces:
  - `iter_nals(data: bytes) -> Iterator[tuple[int, int]]`: `(offset_do_start_code, tipo_do_nal)`.
  - `split_access_units(data: bytes) -> list[bytes]`: um item por quadro; descarta bytes antes do primeiro NAL; nunca lança exceção.
  - `is_keyframe(au: bytes) -> bool`: `True` se tem um NAL tipo 5.

- [ ] **Step 1: Escrever os testes que falham**

`worker/tests/test_h264.py`:
```python
from replay_worker.h264 import is_keyframe, iter_nals, split_access_units
from tests.helpers import nal


def test_iter_nals_informa_offset_e_tipo():
    data = nal(7) + nal(8) + nal(5)
    nals = list(iter_nals(data))
    assert [t for _, t in nals] == [7, 8, 5]
    assert nals[0][0] == 0


def test_iter_nals_aceita_start_code_de_3_bytes():
    data = b"\x00\x00\x01" + bytes([1]) + b"\x11"
    assert list(iter_nals(data)) == [(0, 1)]


def test_iter_nals_ignora_lixo_e_bit_proibido():
    assert list(iter_nals(b"\x01\x02\x03")) == []
    assert list(iter_nals(b"\x00\x00\x01\xff\x11")) == []
    assert list(iter_nals(b"\x00\x00\x01")) == []


def test_split_agrupa_parametros_com_o_idr():
    data = nal(7) + nal(8) + nal(5) + nal(1) + nal(1)
    assert split_access_units(data) == [nal(7) + nal(8) + nal(5), nal(1), nal(1)]


def test_split_dois_gops():
    data = nal(7) + nal(5) + nal(1) + nal(7) + nal(5)
    assert split_access_units(data) == [nal(7) + nal(5), nal(1), nal(7) + nal(5)]


def test_split_descarta_lixo_antes_do_primeiro_nal():
    assert split_access_units(b"\xde\xad\xbe\xef" + nal(1)) == [nal(1)]


def test_split_vazio_e_lixo_nao_lancam():
    assert split_access_units(b"") == []
    assert split_access_units(b"\x01\x02\x03\x04") == []


def test_is_keyframe():
    assert is_keyframe(nal(7) + nal(5))
    assert not is_keyframe(nal(1))
    assert not is_keyframe(b"")
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_h264.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'replay_worker.h264'`

- [ ] **Step 3: Implementar**

`worker/replay_worker/h264.py`:
```python
"""
h264.py — utilidades de H.264 Annex-B (sem dependências).

Premissa (a validar na câmera real, ver smoke.py): cada quadro é uma fatia só
(NAL tipo 1 ou 5), e os conjuntos de parâmetros (SPS=7, PPS=8) vêm colados
antes do IDR do mesmo quadro.
"""
from collections.abc import Iterator

_START3 = b"\x00\x00\x01"


def iter_nals(data: bytes) -> Iterator[tuple[int, int]]:
    """Gera (offset do start code, tipo do NAL) para cada NAL do buffer.

    O offset inclui o zero inicial quando o start code tem 4 bytes. Bytes com o
    bit proibido ligado (>= 0x80 logo após o start code) são lixo e são pulados.
    """
    n = len(data)
    i = 0
    while True:
        p = data.find(_START3, i)
        if p < 0 or p + 3 >= n:
            return
        i = p + 3
        header = data[p + 3]
        if header & 0x80:
            continue
        yield (p - 1 if p > 0 and data[p - 1] == 0 else p), header & 0x1F


def split_access_units(data: bytes) -> list[bytes]:
    """Separa o fluxo em quadros. Descarta bytes antes do primeiro NAL."""
    nals = list(iter_nals(data))
    if not nals:
        return []
    starts = [nals[0][0]]
    has_slice = False
    for off, t in nals:
        if t in (1, 5):
            if has_slice:
                starts.append(off)
            has_slice = True
        elif t in (7, 9):
            if has_slice:
                starts.append(off)
            has_slice = False
    bounds = starts + [len(data)]
    return [data[a:b] for a, b in zip(bounds, bounds[1:])]


def is_keyframe(au: bytes) -> bool:
    """True se o quadro contém um IDR (NAL tipo 5)."""
    return any(t == 5 for _, t in iter_nals(au))
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_h264.py -v`
Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
cd C:/Codes/Camera_Replay
git add worker/replay_worker/h264.py worker/tests/test_h264.py
git commit -m "feat(worker): separação de quadros H.264 e detecção de keyframe

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `ring.py` — anel com corte no keyframe

**Files:**
- Create: `worker/replay_worker/ring.py`
- Test: `worker/tests/test_ring.py`

**Interfaces:**
- Consumes: `is_keyframe(au) -> bool` (Tarefa 2); `feed`, `KEY`, `P`, `nal` (Tarefa 1).
- Produces:
  - `Ring(keep_seconds=40.0, max_bytes=64*1024*1024, max_gap=3.0)`
  - `Ring.append(t: float, au: bytes) -> None` (seguro entre threads)
  - `Ring.cut(end_t: float, seconds: float = 30.0) -> Cut | None`
  - `Ring.stats() -> RingStats`; `len(ring)`; `ring.size_bytes`
  - `Cut(data: bytes, start_t: float, end_t: float, partial: bool, has_gap: bool)` com a propriedade `duration`.
  - `RingStats(frames: int, bytes: int, span: float, keyframes: int, fps: float)`

- [ ] **Step 1: Escrever os testes que falham**

`worker/tests/test_ring.py`:
```python
from replay_worker.h264 import split_access_units
from replay_worker.ring import Ring
from tests.helpers import KEY, P, feed


def test_corta_30s_a_partir_do_keyframe_anterior():
    ring = Ring(keep_seconds=40.0)
    feed(ring, 60)                      # t = 0..59, keyframes em 0,10,...,50
    cut = ring.cut(59.0, 30.0)
    assert cut is not None
    assert cut.start_t == 20.0          # último keyframe com t <= 59 - 30
    assert cut.end_t == 59.0
    assert cut.duration == 39.0
    assert not cut.partial and not cut.has_gap
    assert len(split_access_units(cut.data)) == 40


def test_ignora_quadros_depois_do_fim_pedido():
    ring = Ring(keep_seconds=100.0)
    feed(ring, 60)
    cut = ring.cut(40.0, 30.0)
    assert cut.start_t == 10.0
    assert cut.end_t == 40.0
    assert cut.duration == 30.0
    assert not cut.partial


def test_anel_curto_vira_clipe_parcial():
    ring = Ring()
    feed(ring, 15)                      # só 14 s de vídeo
    cut = ring.cut(14.0, 30.0)
    assert cut.partial
    assert cut.start_t == 0.0
    assert cut.duration == 14.0


def test_vazio_ou_sem_keyframe_devolve_none():
    ring = Ring()
    assert ring.cut(10.0) is None
    ring.append(1.0, P)
    ring.append(2.0, P)
    assert ring.cut(2.0) is None


def test_buraco_no_meio_marca_has_gap():
    ring = Ring(keep_seconds=100.0)
    feed(ring, 10)                      # t = 0..9
    feed(ring, 10, start=20.0)          # t = 20..29
    cut = ring.cut(29.0, 30.0)
    assert cut.has_gap


def test_fluxo_morto_no_instante_do_aperto_marca_has_gap():
    ring = Ring()
    feed(ring, 10)                      # último quadro em t = 9
    cut = ring.cut(20.0, 30.0)
    assert cut.has_gap


def test_teto_de_bytes_limita_o_anel():
    ring = Ring(keep_seconds=10_000.0, max_bytes=100)
    for i in range(50):
        ring.append(float(i), P)
    assert ring.size_bytes <= 100
    assert len(ring) >= 1


def test_stats():
    ring = Ring(keep_seconds=40.0)
    feed(ring, 60)
    s = ring.stats()
    assert s.frames == 41               # t = 19..59
    assert s.keyframes == 4             # t = 20,30,40,50
    assert s.span == 40.0
    assert s.fps == 1.0
    assert s.bytes == ring.size_bytes


def test_append_vazio_e_ignorado():
    ring = Ring()
    ring.append(1.0, b"")
    assert len(ring) == 0
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_ring.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'replay_worker.ring'`

- [ ] **Step 3: Implementar**

`worker/replay_worker/ring.py`:
```python
"""
ring.py — anel de quadros H.264 em memória, com corte no keyframe.

Guarda os últimos `keep_seconds` de vídeo (e no máximo `max_bytes`). O corte
começa no último keyframe com t <= fim - segundos, então o clipe sai com um
pouco mais de 30 s e é decodificável desde o primeiro quadro.
"""
import threading
from collections import deque
from dataclasses import dataclass

from .h264 import is_keyframe


@dataclass(frozen=True)
class Frame:
    t: float
    data: bytes
    key: bool


@dataclass(frozen=True)
class Cut:
    data: bytes
    start_t: float
    end_t: float
    partial: bool    # o anel não tinha segundos suficientes antes do fim pedido
    has_gap: bool    # houve buraco (queda/reconexão) dentro do trecho

    @property
    def duration(self) -> float:
        return self.end_t - self.start_t


@dataclass(frozen=True)
class RingStats:
    frames: int
    bytes: int
    span: float
    keyframes: int
    fps: float


class Ring:
    def __init__(self, keep_seconds=40.0, max_bytes=64 * 1024 * 1024, max_gap=3.0):
        self.keep_seconds = keep_seconds
        self.max_bytes = max_bytes
        self.max_gap = max_gap
        self._frames: deque[Frame] = deque()
        self._bytes = 0
        self._lock = threading.Lock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._frames)

    @property
    def size_bytes(self) -> int:
        with self._lock:
            return self._bytes

    def append(self, t: float, au: bytes) -> None:
        if not au:
            return
        frame = Frame(t, au, is_keyframe(au))
        with self._lock:
            self._frames.append(frame)
            self._bytes += len(au)
            while len(self._frames) > 1 and (
                t - self._frames[0].t > self.keep_seconds or self._bytes > self.max_bytes
            ):
                self._bytes -= len(self._frames.popleft().data)

    def cut(self, end_t: float, seconds: float = 30.0) -> Cut | None:
        """Corta ~`seconds` terminando em `end_t`. None se não houver keyframe utilizável."""
        with self._lock:
            frames = [f for f in self._frames if f.t <= end_t]
        keys = [i for i, f in enumerate(frames) if f.key]
        if not keys:
            return None
        want_start = end_t - seconds
        before = [i for i in keys if frames[i].t <= want_start]
        partial = not before
        start = before[-1] if before else keys[0]
        chosen = frames[start:]
        times = [f.t for f in chosen]
        gaps = [b - a for a, b in zip(times, times[1:])]
        gaps.append(end_t - times[-1])           # fluxo morto perto do aperto
        return Cut(
            data=b"".join(f.data for f in chosen),
            start_t=times[0],
            end_t=times[-1],
            partial=partial,
            has_gap=any(g > self.max_gap for g in gaps),
        )

    def stats(self) -> RingStats:
        with self._lock:
            frames = list(self._frames)
            size = self._bytes
        if len(frames) < 2:
            return RingStats(len(frames), size, 0.0, sum(f.key for f in frames), 0.0)
        span = frames[-1].t - frames[0].t
        fps = (len(frames) - 1) / span if span > 0 else 0.0
        return RingStats(len(frames), size, span, sum(f.key for f in frames), fps)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_ring.py -v`
Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
cd C:/Codes/Camera_Replay
git add worker/replay_worker/ring.py worker/tests/test_ring.py
git commit -m "feat(worker): anel de quadros com corte no keyframe

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `mux.py` — H.264 para MP4 com ffmpeg

**Files:**
- Create: `worker/replay_worker/mux.py`
- Test: `worker/tests/test_mux.py`

**Interfaces:**
- Consumes: `split_access_units` (Tarefa 2).
- Produces: `MuxError(RuntimeError)`, `find_ffmpeg() -> str | None`, `h264_to_mp4(h264: bytes, fps: float, ffmpeg: str | None = None) -> bytes`.

- [ ] **Step 1: Instalar o ffmpeg (uma vez)**

Run: `winget install Gyan.FFmpeg` e abra um terminal novo. Confira com `ffmpeg -version`.
Sem ele, os testes abaixo são pulados (`skipped`), mas o plano só termina com eles passando.

- [ ] **Step 2: Escrever os testes**

`worker/tests/test_mux.py`:
```python
import subprocess

import pytest

from replay_worker.h264 import split_access_units
from replay_worker.mux import MuxError, find_ffmpeg, h264_to_mp4

pytestmark = pytest.mark.skipif(find_ffmpeg() is None, reason="ffmpeg não instalado")


def _amostra_h264() -> bytes:
    """2 s de H.264 Annex-B real (30 quadros), gerado pelo próprio ffmpeg."""
    r = subprocess.run(
        [find_ffmpeg(), "-hide_banner", "-loglevel", "error", "-f", "lavfi",
         "-i", "testsrc=duration=2:size=320x240:rate=15", "-c:v", "libx264",
         "-g", "15", "-f", "h264", "pipe:1"],
        capture_output=True,
    )
    if r.returncode != 0 or not r.stdout:
        pytest.skip("ffmpeg sem libx264")
    return r.stdout


def test_mp4_tem_caixa_ftyp():
    mp4 = h264_to_mp4(_amostra_h264(), fps=15)
    assert mp4[4:8] == b"ftyp"


def test_lixo_levanta_muxerror():
    with pytest.raises(MuxError):
        h264_to_mp4(b"isto nao e video", fps=15)


def test_separacao_de_quadros_bate_com_a_contagem_real():
    assert len(split_access_units(_amostra_h264())) == 30
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_mux.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'replay_worker.mux'`

- [ ] **Step 4: Implementar**

`worker/replay_worker/mux.py`:
```python
"""
mux.py — H.264 Annex-B -> MP4 com `ffmpeg -c copy` (sem recodificar).

O H.264 cru não tem tempo; o `fps` informado define a velocidade de reprodução.
"""
import os
import shutil
import subprocess
import tempfile


class MuxError(RuntimeError):
    pass


def find_ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def h264_to_mp4(h264: bytes, fps: float, ffmpeg: str | None = None) -> bytes:
    ff = ffmpeg or find_ffmpeg()
    if not ff:
        raise MuxError("ffmpeg não encontrado")
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "clip.mp4")
        r = subprocess.run(
            [ff, "-hide_banner", "-loglevel", "error", "-y", "-fflags", "+genpts",
             "-r", str(fps), "-f", "h264", "-i", "pipe:0", "-c:v", "copy",
             "-movflags", "+faststart", out],
            input=h264, capture_output=True, timeout=60,
        )
        if r.returncode != 0:
            raise MuxError(r.stderr.decode("utf-8", "replace").strip()[:300])
        if not os.path.exists(out) or os.path.getsize(out) == 0:
            raise MuxError("ffmpeg não gerou saída")
        with open(out, "rb") as f:
            return f.read()
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_mux.py -v`
Expected: `3 passed` (se `skipped`, instale o ffmpeg e repita)

- [ ] **Step 6: Commit**

```bash
cd C:/Codes/Camera_Replay
git add worker/replay_worker/mux.py worker/tests/test_mux.py
git commit -m "feat(worker): conversão H.264 para MP4 sem recodificar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pacote `xm/` — protocolo da câmera portado

Portar de `C:/Codes/strukti-site/camera/src/` só o necessário para o stream remoto ao vivo, sem depender de `config.py` e sem `print` de depuração.

**Files:**
- Create: `worker/replay_worker/xm/crypto.py`, `worker/replay_worker/xm/cloud.py`, `worker/replay_worker/xm/wire.py`, `worker/replay_worker/xm/relay.py`
- Test: `worker/tests/test_xm_crypto.py`, `worker/tests/test_xm_wire.py`

**Interfaces:**
- Produces:
  - `xm.crypto`: `xor_crypt(data: bytes, key) -> bytes`, `nonce(n: int = 8) -> str`, `sofia_hash(password: str) -> str`
  - `xm.cloud`: `jftech_post(url: str, obj: dict, timeout: int = 10) -> dict`
  - `xm.wire`: `MSG_VIDEO = 1412`, `netip(js, sid=0, msgid=0, seq=0, chn=0) -> bytes`, `NetIPReader(sock)` com `.read() -> tuple[int, bytes] | None` e `.wait(mids, tries=25)`, `find_last_marker(buf) -> int`, `dewrap(media: bytes) -> bytes`, `video_chunks(reader) -> Iterator[bytes]`
  - `xm.relay`: `CameraCreds(sn, authcode, local_user, local_pwd, name="")`, `RelayError`, `connect_live(cam, read_timeout=15.0) -> tuple[socket, NetIPReader]`

- [ ] **Step 1: Escrever os testes que falham**

`worker/tests/test_xm_crypto.py`:
```python
from replay_worker.xm.crypto import nonce, sofia_hash, xor_crypt


def test_sofia_hash_vetor_conhecido():
    assert sofia_hash("admin") == "6QNMIQGe"
    assert sofia_hash("") == "tlJwpbo6"


def test_xor_ida_e_volta():
    assert xor_crypt(xor_crypt(b"ola mundo", "chave"), "chave") == b"ola mundo"
    assert xor_crypt(b"abc", b"") == b"abc"


def test_nonce_tem_o_tamanho_pedido_e_e_alfanumerico():
    n = nonce(8)
    assert len(n) == 8 and n.isalnum()
```

`worker/tests/test_xm_wire.py`:
```python
from replay_worker.xm.wire import (NetIPReader, dewrap, find_last_marker, netip,
                                   video_chunks)
from tests.helpers import nal


def xmf(tipo, h264):
    """Quadro XM sintético: marcador 00 00 01 <tipo> + 4 bytes de cabeçalho + H.264."""
    return b"\x00\x00\x01" + bytes([tipo]) + b"\x01\x02\x03\x04" + h264


class FakeSock:
    def __init__(self, chunks):
        self.chunks = list(chunks)

    def recv(self, n):
        return self.chunks.pop(0) if self.chunks else b""


class FakeReader:
    def __init__(self, msgs):
        self.msgs = list(msgs)

    def read(self):
        return self.msgs.pop(0) if self.msgs else None


def test_dewrap_extrai_video_e_pula_audio():
    media = xmf(0xFC, nal(7) + nal(5)) + xmf(0xFA, b"\x99\x98") + xmf(0xFD, nal(1))
    assert dewrap(media) == nal(7) + nal(5) + nal(1)


def test_dewrap_lixo_nao_lanca():
    assert dewrap(b"") == b""
    assert dewrap(b"\x01\x02\x03\x04\x05") == b""


def test_find_last_marker():
    f1 = xmf(0xFC, nal(7) + nal(5))
    assert find_last_marker(f1 + xmf(0xFD, nal(1))) == len(f1)
    assert find_last_marker(b"sem marcador") == -1


def test_netip_atravessa_recv_fragmentado():
    pkt = netip('{"a":1}', sid=5, msgid=1412)
    r = NetIPReader(FakeSock([pkt[:7], pkt[7:25], pkt[25:]]))
    assert r.read() == (1412, b'{"a":1}\x00')
    assert r.read() is None


def test_video_chunks_segura_o_ultimo_quadro_ate_o_proximo_marcador():
    f1 = xmf(0xFC, nal(7) + nal(5))
    f2 = xmf(0xFD, nal(1))
    f3 = xmf(0xFD, nal(1))
    reader = FakeReader([
        (1412, f1[:10]),
        (1412, f1[10:] + f2),
        (1000, b"{}"),            # mensagem de controle: ignorada
        (1412, f3),
    ])
    assert list(video_chunks(reader)) == [nal(7) + nal(5), nal(1)]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_xm_crypto.py tests/test_xm_wire.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'replay_worker.xm.crypto'`

- [ ] **Step 3: Implementar `crypto.py` e `cloud.py`**

`worker/replay_worker/xm/crypto.py`:
```python
"""Cripto mínima do FunSDK usada no acesso remoto (XOR, nonce, hash sofia).

Portado de camera/src/xmcrypto.py (sem a parte de credenciais da conta).
"""
import hashlib
import random
import string


def xor_crypt(data: bytes, key) -> bytes:
    """out[i] = in[i] ^ key[i % len(key)] (XorEncrypt/XorDecrypt do SDK)."""
    kb = key.encode("utf-8") if isinstance(key, str) else key
    if not kb:
        return bytes(data)
    return bytes(data[i] ^ kb[i % len(kb)] for i in range(len(data)))


def nonce(n: int = 8) -> str:
    alfa = string.ascii_letters + string.digits
    return "".join(random.choice(alfa) for _ in range(n))


def sofia_hash(password: str) -> str:
    """Hash 'sofia' do login DVRIP local."""
    m = hashlib.md5(password.encode("utf-8")).digest()
    out = ""
    for i in range(8):
        n = (m[2 * i] + m[2 * i + 1]) % 62
        if n < 10:
            out += chr(n + 48)
        elif n < 36:
            out += chr(n + 55)
        else:
            out += chr(n + 61)
    return out
```

`worker/replay_worker/xm/cloud.py`:
```python
"""Cliente mínimo do XMCloud (protocolo JFTECH): POST cifrado por XOR.

Portado de camera/src/xmcloud.py (só jftech_post).
"""
import base64
import json
import re
import ssl
import time
import urllib.request

from . import crypto

UA = "funsdk-v1.8.2-Android"
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE   # o servidor do fabricante não precisa ser verificado


def _b64fix(s):
    s = re.sub(r"[^A-Za-z0-9+/=]", "", s).rstrip("=")
    return base64.b64decode(s + "=" * (-len(s) % 4))


def jftech_post(url, obj, timeout=10):
    """Envia um objeto JSON cifrado (JFTECH) e devolve o JSON decifrado da resposta."""
    ts = int(time.time() * 1000)
    nonce = crypto.nonce(8)
    key = "%d%s" % (ts, nonce)
    body = base64.b64encode(crypto.xor_crypt(json.dumps(obj).encode("utf-8"), key))
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "text/plain")
    req.add_header("JFTECH-EV", "3")
    req.add_header("JFTECH-REQ", nonce)
    req.add_header("JFTECH-TIME", str(ts))
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "*/*")
    with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
        raw = r.read()
        rt = r.headers.get("JFTECH-TIME")
        rq = r.headers.get("JFTECH-REQ")
    if not (rt and rq):
        raise RuntimeError("resposta sem headers JFTECH (key indisponível): %r" % raw[:80])
    pt = crypto.xor_crypt(_b64fix(raw.decode("latin1")), rt + rq)
    return json.loads(pt.decode("utf-8", "replace"))
```

> **Atenção (segurança, herdada do projeto original):** `cloud.py` desliga a verificação de certificado TLS (`CERT_NONE`) nas chamadas aos servidores do fabricante, como em `camera/src/xmcloud.py`. Isso permite ataque de homem no meio contra o `AuthCode` e as credenciais. É aceitável só para a bancada. **Antes de rodar em produção**, o Agente de Captura deve testar com a verificação ligada (`ssl.create_default_context()` sem as duas linhas de override); se o servidor do fabricante usar certificado inválido, registrar o motivo e fixar o certificado (pinning) em vez de desligar a checagem. Isso entra como item de revisão do agente de Revisão.

- [ ] **Step 4: Implementar `wire.py`**

`worker/replay_worker/xm/wire.py`:
```python
"""
wire.py — formato de fio do NetIP/XM: cabeçalho, leitor de pacotes e de-wrap.

Portado de camera/src/xmremote.py e camera/src/webcam.py. Um quadro XM chega
quebrado em vários pacotes NetIP; por isso `video_chunks` acumula o bruto e só
de-wrapa até o ÚLTIMO marcador XM (o resto espera o próximo ciclo).
"""
from collections.abc import Iterator

MSG_VIDEO = 1412   # dados de vídeo neste firmware


def netip(js, sid=0, msgid=0, seq=0, chn=0) -> bytes:
    """Pacote NetIP: cabeçalho de 20 bytes + JSON terminado em NUL."""
    pl = js.encode("utf-8") + b"\x00"
    h = bytearray(20)
    h[0] = 0xFF
    h[1] = 0x01
    h[4:8] = (sid & 0xFFFFFFFF).to_bytes(4, "little")
    h[8:12] = (seq & 0xFFFFFFFF).to_bytes(4, "little")
    h[12] = chn
    h[14:16] = msgid.to_bytes(2, "little")
    h[16:20] = len(pl).to_bytes(4, "little")
    return bytes(h) + pl


class NetIPReader:
    def __init__(self, sock):
        self.sock = sock
        self.buf = bytearray()

    def _fill(self):
        d = self.sock.recv(65536)
        if not d:
            return False
        self.buf += d
        return True

    def read(self):
        """Próximo pacote como (msgid, payload), ou None se a conexão fechou."""
        while True:
            i = self.buf.find(b"\xff")
            if i < 0:
                self.buf.clear()
                if not self._fill():
                    return None
                continue
            if i:
                del self.buf[:i]
            while len(self.buf) < 20:
                if not self._fill():
                    return None
            mid = int.from_bytes(self.buf[14:16], "little")
            ln = int.from_bytes(self.buf[16:20], "little")
            while len(self.buf) < 20 + ln:
                if not self._fill():
                    return None
            pl = bytes(self.buf[20:20 + ln])
            del self.buf[:20 + ln]
            return mid, pl

    def wait(self, mids, tries=25):
        """Lê até achar um pacote de `mids`; devolve (msgid, texto JSON) ou (None, None)."""
        for _ in range(tries):
            fr = self.read()
            if fr is None:
                return None, None
            if fr[0] in mids:
                return fr[0], fr[1].split(b"\x00")[0].decode("utf-8", "ignore")
        return None, None


def _is_marker(b, i):
    return (i + 4 <= len(b) and b[i] == 0 and b[i + 1] == 0 and b[i + 2] == 1
            and 0xF8 <= b[i + 3] <= 0xFE)


def find_last_marker(buf) -> int:
    """Offset do último marcador XM (00 00 01 F8..FE) no buffer, ou -1."""
    i = len(buf) - 4
    while i >= 0:
        if _is_marker(buf, i):
            return i
        i -= 1
    return -1


def dewrap(media: bytes) -> bytes:
    """Remove os cabeçalhos XM e devolve só o H.264 Annex-B.

    Vídeo: marcadores FC/FE (I) e FD (P). Áudio (FA/F9/F8) é descartado. Nunca
    lança exceção: bytes sem marcador resultam em vazio.
    """
    n = len(media)
    out = bytearray()
    i = 0

    def next_marker(j):
        while j + 4 <= n:
            if _is_marker(media, j):
                return j
            j += 1
        return n

    while i + 4 <= n:
        if _is_marker(media, i):
            t = media[i + 3]
            end = next_marker(i + 4)
            if t in (0xFC, 0xFD, 0xFE):
                seg = media[i + 4:end]
                k = seg.find(b"\x00\x00\x00\x01")
                if k < 0:
                    k = seg.find(b"\x00\x00\x01")
                if k >= 0:
                    out += seg[k:]
            i = end
        else:
            i += 1
    return bytes(out)


def video_chunks(reader) -> Iterator[bytes]:
    """H.264 Annex-B desembrulhado, a partir de qualquer objeto com `.read()`."""
    raw = bytearray()
    while True:
        fr = reader.read()
        if fr is None:
            return
        mid, payload = fr
        if mid != MSG_VIDEO:
            continue
        raw += payload
        last = find_last_marker(raw)
        if last > 0:
            h = dewrap(bytes(raw[:last]))
            del raw[:last]
            if h:
                yield h
```

- [ ] **Step 5: Implementar `relay.py`**

`worker/replay_worker/xm/relay.py`:
```python
"""
relay.py — conexão remota ao vivo via relay da nuvem do fabricante.

Portado de camera/src/webcam.py (connect_live), sem config.py. Passos: STATUS
(Online + ServerIP) -> CLI_NEED_CON (a câmera disca para o relay) -> handshake
do relay -> login DVRIP local (MD5) -> Claim + Start do OPMonitor.
"""
import base64
import random
import re
import socket
import string
from dataclasses import dataclass

from . import cloud
from .crypto import sofia_hash
from .wire import NetIPReader, netip

STATUS_HOST = "pub-status.secu100.net"
_PARAMS = ('{"Channel":0,"CombinMode":"CONNECT_ALL","StreamType":"Main","TransMode":"TCP"}')


@dataclass(frozen=True)
class CameraCreds:
    sn: str
    authcode: str
    local_user: str
    local_pwd: str
    name: str = ""


class RelayError(RuntimeError):
    pass


def _rnd(n, alfa):
    return "".join(random.choice(alfa) for _ in range(n))


def connect_live(cam: CameraCreds, read_timeout: float = 15.0):
    """Abre o stream ao vivo. Devolve (socket, NetIPReader). Levanta RelayError."""
    ac, sn = cam.authcode, cam.sn
    ct = "c_" + _rnd(24, string.ascii_lowercase + string.digits)
    sid = _rnd(32, string.ascii_lowercase + string.digits)

    rq = {"StatusProtocol": {"Header": {"Version": "1.0", "CSeq": "1",
          "MessageType": "MSG_STATUS_LOCALQUERY_REQ"},
          "Body": [{"SerialNumber": sn, "AuthCode": ac}]}}
    d = cloud.jftech_post("https://%s:7605/" % STATUS_HOST, rq, timeout=9)
    row = next((x for x in d["StatusProtocol"]["Body"] if x.get("SerialNumber") == sn), {})
    if row.get("Status") != "Online":
        raise RelayError("câmera offline (ou AuthCode inválido)")
    serverip = row["ServerIP"]

    need = {"AgentProtocol": {"Body": {"Authcode": ac, "ClientToken": ct, "DestPort": "34567",
            "Encrypt": "1", "ProtocolMode": "tcp", "SerialNumber": sn, "ServiceType": "RpsCmd",
            "SessionId": sid, "Step": "0"},
            "Header": {"MessageType": "MSG_CLI_NEED_CON_REQ", "Version": "1.0"}}}
    rr = cloud.jftech_post("https://%s:6510/" % serverip, need, timeout=9)
    b = rr["AgentProtocol"]["Body"]
    agent, aport = b["AgentServerIp"], int(b["AgentServerPort"])

    s = socket.socket()
    try:
        s.settimeout(12)
        s.connect((agent, aport))
        s.sendall(base64.b64encode(("%s:%s:%s:%s" % (ac, ct, sn, sid)).encode()) + b"XXEE")
        s.recv(2048)
        rd = NetIPReader(s)

        # pré-login Claim (SID 0x1869f, canal 99) -> 1414
        s.sendall(netip('{"Name":"OPMonitor","OPMonitor":{"Action":"Claim","Parameter":%s},'
                        '"DHParameter":{"RandomStrA":"%s"},"SessionID":"0x000001869f"}'
                        % (_PARAMS, _rnd(4, string.ascii_uppercase + string.digits)),
                        sid=0x1869F, msgid=1413, seq=1, chn=99))
        rd.wait({1414})

        # login local MD5 -> 1001
        s.sendall(netip('{"EncryptType":"MD5","LoginType":"DVRIP-Web","UserName":"%s",'
                        '"PassWord":"%s","User-Agent":"replay-worker"}'
                        % (cam.local_user, sofia_hash(cam.local_pwd)),
                        sid=0, msgid=1000, seq=2))
        _, t = rd.wait({1001})
        m = re.search(r'"SessionID"\s*:\s*"?(0x[0-9a-fA-F]+)"?', t or "")
        ret = re.search(r'"Ret"\s*:\s*(\d+)', t or "")
        if not m or (ret and ret.group(1) != "100"):
            raise RelayError("login falhou (Ret=%s)" % (ret and ret.group(1)))
        sess = int(m.group(1), 16)

        s.sendall(netip('{"Name":"OPMonitor","OPMonitor":{"Action":"Claim","Parameter":%s},'
                        '"SessionID":"%s"}' % (_PARAMS, hex(sess)),
                        sid=sess, msgid=1413, seq=3))
        rd.wait({1414})
        s.sendall(netip('{"Name":"OPMonitor","OPMonitor":{"Action":"Start","Parameter":%s},'
                        '"SessionID":"%s"}' % (_PARAMS, hex(sess)),
                        sid=sess, msgid=1410, seq=4))
        s.settimeout(read_timeout)   # fluxo mudo por muito tempo = conexão morta
        return s, rd
    except Exception:
        s.close()
        raise
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_xm_crypto.py tests/test_xm_wire.py -v`
Expected: `8 passed`

- [ ] **Step 7: Commit**

```bash
cd C:/Codes/Camera_Replay
git add worker/replay_worker/xm worker/tests/test_xm_crypto.py worker/tests/test_xm_wire.py
git commit -m "feat(worker): protocolo XM/NetIP portado (relay, de-wrap, login local)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Fontes de vídeo, configuração e `CameraCapture`

**Files:**
- Create: `worker/replay_worker/config.py`, `worker/replay_worker/source.py`, `worker/replay_worker/capture.py`
- Test: `worker/tests/test_config.py`, `worker/tests/test_source.py`, `worker/tests/test_capture.py`

**Interfaces:**
- Consumes: `CameraCreds`, `connect_live` (Tarefa 5); `video_chunks` (Tarefa 5); `split_access_units` (Tarefa 2); `Ring` (Tarefa 3).
- Produces:
  - `config.load_cameras(path: str) -> dict[str, CameraCreds]`
  - `source.VideoSource` (Protocol): `open() -> None`, `chunks() -> Iterator[bytes]`, `close() -> None`
  - `source.RelaySource(creds)`; `source.FileSource(path, fps=15.0, loop=True, sleep=time.sleep)`
  - `capture.CameraCapture(camera_id, make_source, ring, clock=time.time, backoff=(1,2,4,8,16,32,60), offline_after=30.0)` com `run_once() -> None`, `run_forever(stop: threading.Event, wait=None) -> None`, `status` (`"online"` ou `"offline"`), `last_error: str | None`, `session_frames: int`.

- [ ] **Step 1: Escrever os testes que falham**

`worker/tests/test_config.py`:
```python
import json

import pytest

from replay_worker.config import load_cameras


def test_carrega_cameras_por_sn(tmp_path):
    p = tmp_path / "cameras.json"
    p.write_text(json.dumps({"cameras": [
        {"sn": "S1", "name": "Quadra 1", "authcode": "A", "local_user": "u", "local_pwd": "p"},
    ]}), encoding="utf-8")
    cams = load_cameras(str(p))
    assert cams["S1"].authcode == "A"
    assert cams["S1"].local_user == "u"
    assert cams["S1"].name == "Quadra 1"


def test_campo_faltando_da_erro_claro(tmp_path):
    p = tmp_path / "cameras.json"
    p.write_text(json.dumps({"cameras": [{"sn": "S1"}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="S1"):
        load_cameras(str(p))
```

`worker/tests/test_source.py`:
```python
from replay_worker.source import FileSource
from tests.helpers import KEY, P


def test_filesource_gera_um_quadro_por_vez_no_ritmo_do_fps(tmp_path):
    f = tmp_path / "v.h264"
    f.write_bytes(KEY + P + P)
    pausas = []
    src = FileSource(str(f), fps=10.0, loop=False, sleep=pausas.append)
    src.open()
    assert list(src.chunks()) == [KEY, P, P]
    assert pausas == [0.1, 0.1, 0.1]
    src.close()


def test_filesource_em_loop_repete_o_arquivo(tmp_path):
    f = tmp_path / "v.h264"
    f.write_bytes(KEY + P)
    src = FileSource(str(f), fps=10.0, loop=True, sleep=lambda s: None)
    src.open()
    it = src.chunks()
    assert [next(it) for _ in range(5)] == [KEY, P, KEY, P, KEY]
```

`worker/tests/test_capture.py`:
```python
import threading

from replay_worker.capture import CameraCapture
from replay_worker.ring import Ring
from tests.helpers import KEY, P


class FakeSource:
    def __init__(self, chunks=(), fail_open=False):
        self._chunks = list(chunks)
        self._fail_open = fail_open
        self.closed = False

    def open(self):
        if self._fail_open:
            raise RuntimeError("câmera offline")

    def chunks(self):
        yield from self._chunks

    def close(self):
        self.closed = True


class Relogio:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def test_run_once_alimenta_o_anel_e_fecha_a_fonte():
    ring = Ring()
    src = FakeSource([KEY + P, P])
    cap = CameraCapture("cam1", lambda: src, ring, clock=Relogio())
    cap.run_once()
    assert len(ring) == 3
    assert cap.session_frames == 3
    assert cap.status == "online"
    assert src.closed


def test_status_vira_offline_sem_video_por_30s():
    rel = Relogio()
    cap = CameraCapture("cam1", lambda: FakeSource([KEY]), Ring(), clock=rel)
    assert cap.status == "offline"          # nunca recebeu vídeo
    cap.run_once()
    assert cap.status == "online"
    rel.t += 31
    assert cap.status == "offline"


def test_reconecta_com_backoff_e_zera_apos_sucesso():
    fontes = iter([
        FakeSource(fail_open=True),
        FakeSource(fail_open=True),
        FakeSource(fail_open=True),
        FakeSource([KEY, P]),            # sucesso: entrega vídeo e termina
    ])
    stop = threading.Event()
    esperas = []

    def wait(delay):
        esperas.append(delay)
        if len(esperas) == 4:
            stop.set()
        return stop.is_set()

    cap = CameraCapture("cam1", lambda: next(fontes), Ring(), clock=Relogio())
    cap.run_forever(stop, wait=wait)
    assert esperas == [1, 2, 4, 1]
    assert "câmera offline" in cap.last_error


def test_backoff_para_no_teto_de_60s():
    fontes = iter([FakeSource(fail_open=True) for _ in range(12)])
    stop = threading.Event()
    esperas = []

    def wait(delay):
        esperas.append(delay)
        if len(esperas) == 12:
            stop.set()
        return stop.is_set()

    cap = CameraCapture("cam1", lambda: next(fontes), Ring(), clock=Relogio())
    cap.run_forever(stop, wait=wait)
    assert esperas == [1, 2, 4, 8, 16, 32, 60, 60, 60, 60, 60, 60]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_config.py tests/test_source.py tests/test_capture.py -v`
Expected: FAIL com `ModuleNotFoundError` (`replay_worker.config`, `.source`, `.capture`)

- [ ] **Step 3: Implementar `config.py`**

`worker/replay_worker/config.py`:
```python
"""config.py — carrega as câmeras de um cameras.json (nunca versionado)."""
import json

from .xm.relay import CameraCreds

_OBRIGATORIOS = ("sn", "authcode", "local_user", "local_pwd")


def load_cameras(path: str) -> dict[str, CameraCreds]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    cams: dict[str, CameraCreds] = {}
    for item in data.get("cameras", []):
        faltando = [k for k in _OBRIGATORIOS if not item.get(k)]
        if faltando:
            raise ValueError("câmera %s sem os campos: %s"
                             % (item.get("sn", "?"), ", ".join(faltando)))
        cams[item["sn"]] = CameraCreds(
            sn=item["sn"], authcode=item["authcode"], local_user=item["local_user"],
            local_pwd=item["local_pwd"], name=item.get("name", ""))
    return cams
```

- [ ] **Step 4: Implementar `source.py`**

`worker/replay_worker/source.py`:
```python
"""
source.py — de onde vem o H.264 de uma câmera.

`RelaySource` usa o relay do fabricante. `FileSource` simula uma câmera lendo um
arquivo .h264 no ritmo do fps (testes e bancada). Trocar a origem (por exemplo,
DVRIP local atrás de um gateway) não deve mexer no anel nem na captura.
"""
import time
from collections.abc import Iterator
from typing import Protocol

from .h264 import split_access_units
from .xm.relay import CameraCreds, connect_live
from .xm.wire import video_chunks


class VideoSource(Protocol):
    def open(self) -> None: ...
    def chunks(self) -> Iterator[bytes]: ...
    def close(self) -> None: ...


class RelaySource:
    def __init__(self, creds: CameraCreds):
        self.creds = creds
        self._sock = None
        self._reader = None

    def open(self) -> None:
        self._sock, self._reader = connect_live(self.creds)

    def chunks(self) -> Iterator[bytes]:
        yield from video_chunks(self._reader)

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None


class FileSource:
    def __init__(self, path: str, fps: float = 15.0, loop: bool = True, sleep=time.sleep):
        self.path = path
        self.fps = fps
        self.loop = loop
        self._sleep = sleep
        self._aus: list[bytes] = []

    def open(self) -> None:
        with open(self.path, "rb") as f:
            self._aus = split_access_units(f.read())
        if not self._aus:
            raise RuntimeError("arquivo sem quadros H.264: %s" % self.path)

    def chunks(self) -> Iterator[bytes]:
        while True:
            for au in self._aus:
                yield au
                self._sleep(1.0 / self.fps)
            if not self.loop:
                return

    def close(self) -> None:
        pass
```

- [ ] **Step 5: Implementar `capture.py`**

`worker/replay_worker/capture.py`:
```python
"""
capture.py — mantém uma câmera conectada e o anel alimentado.

Uma sessão = uma conexão. Se a sessão cai ou falha, `run_forever` espera com
backoff (1, 2, 4... até 60 s) e reconecta. Uma sessão que entregou vídeo zera o
backoff. O status é derivado do último quadro recebido (offline após 30 s mudo).
"""
import threading
import time

from .h264 import split_access_units
from .ring import Ring


class CameraCapture:
    def __init__(self, camera_id, make_source, ring: Ring, clock=time.time,
                 backoff=(1, 2, 4, 8, 16, 32, 60), offline_after=30.0):
        self.camera_id = camera_id
        self._make_source = make_source
        self.ring = ring
        self._clock = clock
        self.backoff = backoff
        self.offline_after = offline_after
        self._last_video: float | None = None
        self.last_error: str | None = None
        self.session_frames = 0

    @property
    def status(self) -> str:
        if self._last_video is None:
            return "offline"
        return "online" if self._clock() - self._last_video <= self.offline_after else "offline"

    def run_once(self) -> None:
        """Uma sessão: conecta, alimenta o anel até a fonte terminar ou falhar."""
        self.session_frames = 0
        source = self._make_source()
        try:
            source.open()
            for chunk in source.chunks():
                now = self._clock()
                for au in split_access_units(chunk):
                    self.ring.append(now, au)
                    self.session_frames += 1
                self._last_video = now
        finally:
            source.close()

    def run_forever(self, stop: threading.Event, wait=None) -> None:
        wait = wait or stop.wait
        failures = 0
        while not stop.is_set():
            try:
                self.run_once()
            except Exception as exc:
                self.last_error = repr(exc)
            failures = 0 if self.session_frames else failures + 1
            wait(self.backoff[min(max(failures, 1) - 1, len(self.backoff) - 1)])
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_config.py tests/test_source.py tests/test_capture.py -v`
Expected: `8 passed`

- [ ] **Step 7: Commit**

```bash
cd C:/Codes/Camera_Replay
git add worker/replay_worker/config.py worker/replay_worker/source.py worker/replay_worker/capture.py worker/tests/test_config.py worker/tests/test_source.py worker/tests/test_capture.py
git commit -m "feat(worker): fontes de vídeo, config de câmeras e captura com reconexão

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `clipper.py` e `local.py` — do pedido ao MP4 enviado

**Files:**
- Create: `worker/replay_worker/clipper.py`, `worker/replay_worker/local.py`
- Test: `worker/tests/test_clipper.py`

**Interfaces:**
- Consumes: `Ring.cut` e `Cut` (Tarefa 3); `h264_to_mp4`, `MuxError` (Tarefa 4).
- Produces:
  - `ClipJob(clip_id: str, camera_id: str, pressed_at: float)`
  - `JobQueue` (Protocol): `claim_pending(camera_id) -> list[ClipJob]`, `mark_ready(clip_id, key, size, duration, partial)`, `mark_failed(clip_id, reason)`
  - `Uploader` (Protocol): `upload(clip_id, mp4: bytes) -> str` (devolve a chave no armazenamento)
  - `process_job(job, ring, queue, uploader, fps, seconds=30.0, retries=3, max_age=120.0, clock=time.time, mux=h264_to_mp4) -> bool`
  - `local.MemoryQueue` e `local.LocalDirUploader(directory)`

- [ ] **Step 1: Escrever os testes que falham**

`worker/tests/test_clipper.py`:
```python
from replay_worker.clipper import ClipJob, process_job
from replay_worker.mux import MuxError
from replay_worker.ring import Ring
from tests.helpers import P, feed


class FakeQueue:
    def __init__(self):
        self.ready = []
        self.failed = []

    def mark_ready(self, clip_id, key, size, duration, partial):
        self.ready.append((clip_id, key, size, duration, partial))

    def mark_failed(self, clip_id, reason):
        self.failed.append((clip_id, reason))


class FakeUploader:
    def __init__(self, falhas=0):
        self.falhas = falhas
        self.chamadas = 0

    def upload(self, clip_id, mp4):
        self.chamadas += 1
        if self.chamadas <= self.falhas:
            raise OSError("rede")
        return "clips/%s.mp4" % clip_id


def mux_ok(h264, fps):
    return b"MP4"


def job(pressed_at=59.0):
    return ClipJob("c1", "cam1", pressed_at)


def anel_cheio():
    ring = Ring()
    feed(ring, 60)
    return ring


def run(ring, queue, uploader, j=None, mux=mux_ok, clock=lambda: 60.0):
    return process_job(j or job(), ring, queue, uploader, fps=15, mux=mux, clock=clock)


def test_sucesso_envia_e_marca_pronto():
    q = FakeQueue()
    assert run(anel_cheio(), q, FakeUploader())
    assert q.ready == [("c1", "clips/c1.mp4", 3, 39.0, False)]
    assert q.failed == []


def test_anel_vazio_marca_falhou_sem_lancar():
    q = FakeQueue()
    assert not run(Ring(), q, FakeUploader())
    assert q.failed and "sem vídeo" in q.failed[0][1]


def test_so_quadros_p_marca_falhou():
    ring = Ring()
    ring.append(58.0, P)
    ring.append(59.0, P)
    q = FakeQueue()
    assert not run(ring, q, FakeUploader())
    assert q.failed[0][0] == "c1"


def test_anel_curto_sai_parcial():
    ring = Ring()
    feed(ring, 15)
    q = FakeQueue()
    assert run(ring, q, FakeUploader(), j=job(14.0), clock=lambda: 15.0)
    assert q.ready[0][4] is True


def test_buraco_tambem_sai_parcial():
    ring = Ring(keep_seconds=100.0)
    feed(ring, 10)
    feed(ring, 10, start=20.0)
    q = FakeQueue()
    assert run(ring, q, FakeUploader(), j=job(29.0), clock=lambda: 30.0)
    assert q.ready[0][4] is True


def test_upload_falha_duas_vezes_e_depois_funciona():
    q = FakeQueue()
    up = FakeUploader(falhas=2)
    assert run(anel_cheio(), q, up)
    assert up.chamadas == 3 and q.ready


def test_upload_falha_sempre_marca_falhou_apos_3_tentativas():
    q = FakeQueue()
    up = FakeUploader(falhas=99)
    assert not run(anel_cheio(), q, up)
    assert up.chamadas == 3
    assert "envio" in q.failed[0][1]


def test_muxerror_marca_falhou():
    def mux_ruim(h264, fps):
        raise MuxError("ffmpeg quebrou")

    q = FakeQueue()
    assert not run(anel_cheio(), q, FakeUploader(), mux=mux_ruim)
    assert "ffmpeg" in q.failed[0][1]


def test_pedido_antigo_demais_falha_sem_cortar():
    q = FakeQueue()
    assert not run(anel_cheio(), q, FakeUploader(), clock=lambda: 59.0 + 121.0)
    assert "antigo" in q.failed[0][1]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest tests/test_clipper.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'replay_worker.clipper'`

- [ ] **Step 3: Implementar `clipper.py`**

`worker/replay_worker/clipper.py`:
```python
"""
clipper.py — transforma um pedido de clipe em um MP4 enviado.

A fila (Postgres) e o armazenamento (R2) entram por Protocol; as implementações
reais vêm no plano do Backend. Aqui só vale o contrato:
  - nunca lança: toda falha vira `mark_failed` com um motivo legível;
  - clipe curto ou com buraco vira `partial=True` (status `parcial`), não falha.
"""
import time
from dataclasses import dataclass
from typing import Protocol

from .mux import MuxError, h264_to_mp4
from .ring import Ring


@dataclass(frozen=True)
class ClipJob:
    clip_id: str
    camera_id: str
    pressed_at: float   # segundos desde a época, relógio do servidor (apertos.recebido_em)


class JobQueue(Protocol):
    def claim_pending(self, camera_id: str) -> list[ClipJob]: ...
    def mark_ready(self, clip_id: str, key: str, size: int, duration: float,
                   partial: bool) -> None: ...
    def mark_failed(self, clip_id: str, reason: str) -> None: ...


class Uploader(Protocol):
    def upload(self, clip_id: str, mp4: bytes) -> str: ...


def process_job(job: ClipJob, ring: Ring, queue: JobQueue, uploader: Uploader, fps: float,
                seconds: float = 30.0, retries: int = 3, max_age: float = 120.0,
                clock=time.time, mux=h264_to_mp4) -> bool:
    """Corta, converte e envia. Devolve True se o clipe ficou pronto."""
    if clock() - job.pressed_at > max_age:
        queue.mark_failed(job.clip_id, "pedido antigo demais")
        return False

    cut = ring.cut(job.pressed_at, seconds)
    if cut is None:
        queue.mark_failed(job.clip_id, "sem vídeo no buffer no momento do aperto")
        return False

    try:
        mp4 = mux(cut.data, fps)
    except MuxError as exc:
        queue.mark_failed(job.clip_id, "falha no ffmpeg: %s" % exc)
        return False

    key = None
    erro = None
    for _ in range(retries):
        try:
            key = uploader.upload(job.clip_id, mp4)
            break
        except Exception as exc:
            erro = exc
    if key is None:
        queue.mark_failed(job.clip_id, "falha no envio: %r" % (erro,))
        return False

    queue.mark_ready(job.clip_id, key, len(mp4), cut.duration, cut.partial or cut.has_gap)
    return True
```

- [ ] **Step 4: Implementar `local.py`**

`worker/replay_worker/local.py`:
```python
"""local.py — fila em memória e uploader em pasta, para a bancada e o smoke test."""
import os

from .clipper import ClipJob


class MemoryQueue:
    def __init__(self, jobs: list[ClipJob] | None = None):
        self.pending = list(jobs or [])
        self.ready: list[tuple] = []
        self.failed: list[tuple] = []

    def claim_pending(self, camera_id: str) -> list[ClipJob]:
        mine = [j for j in self.pending if j.camera_id == camera_id]
        self.pending = [j for j in self.pending if j.camera_id != camera_id]
        return mine

    def mark_ready(self, clip_id, key, size, duration, partial):
        self.ready.append((clip_id, key, size, duration, partial))

    def mark_failed(self, clip_id, reason):
        self.failed.append((clip_id, reason))


class LocalDirUploader:
    def __init__(self, directory: str):
        self.directory = directory
        os.makedirs(directory, exist_ok=True)

    def upload(self, clip_id: str, mp4: bytes) -> str:
        path = os.path.join(self.directory, "%s.mp4" % clip_id)
        with open(path, "wb") as f:
            f.write(mp4)
        return path
```

- [ ] **Step 5: Rodar tudo e ver passar**

Run: `cd C:/Codes/Camera_Replay/worker && py -m pytest -v`
Expected: todos passam (mux pode aparecer como `skipped` se não houver ffmpeg)

- [ ] **Step 6: Commit**

```bash
cd C:/Codes/Camera_Replay
git add worker/replay_worker/clipper.py worker/replay_worker/local.py worker/tests/test_clipper.py
git commit -m "feat(worker): processamento do pedido de clipe (corte, mux e envio)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `smoke.py` e validação na câmera real

Valida o maior risco do spec (relay, fps, keyframes, uma fatia por quadro) com a câmera Inova de verdade. **Esta tarefa exige as credenciais da câmera**, que estão no `config.py` ignorado pelo git do projeto antigo e não estão neste PC. Quem tiver o `config.py` converte para `worker/cameras.json`.

**Files:**
- Create: `worker/replay_worker/smoke.py`, `docs/validacao-camera.md`

**Interfaces:**
- Consumes: tudo das Tarefas 2 a 7.
- Produces: CLI `py -m replay_worker.smoke --sn SN [--cameras cameras.json] [--wait 45] [--fps 15] [--out out]`.

- [ ] **Step 1: Implementar o CLI**

`worker/replay_worker/smoke.py`:
```python
"""
smoke.py — teste de bancada com a câmera real.

Conecta pelo relay, enche o anel por --wait segundos, simula um aperto "agora",
corta 30 s e grava o MP4 em --out. Imprime as medidas que o spec pede validar:
fps real, bitrate, intervalo entre keyframes e tamanho do anel.

Uso: py -m replay_worker.smoke --sn <SN> --wait 45
"""
import argparse
import threading
import time

from .capture import CameraCapture
from .clipper import ClipJob, process_job
from .config import load_cameras
from .local import LocalDirUploader, MemoryQueue
from .ring import Ring
from .source import RelaySource


def main() -> int:
    ap = argparse.ArgumentParser(description="Teste de bancada: conecta, enche o anel e corta um clipe.")
    ap.add_argument("--sn", required=True)
    ap.add_argument("--cameras", default="cameras.json")
    ap.add_argument("--wait", type=float, default=45.0, help="segundos de captura antes do aperto")
    ap.add_argument("--fps", type=float, default=15.0, help="fps usado no MP4 (compare com o medido)")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()

    cams = load_cameras(a.cameras)
    if a.sn not in cams:
        print("[-] SN desconhecido. Disponíveis:", ", ".join(cams))
        return 2

    ring = Ring()
    cap = CameraCapture(a.sn, lambda: RelaySource(cams[a.sn]), ring)
    stop = threading.Event()
    threading.Thread(target=cap.run_forever, args=(stop,), daemon=True).start()

    t0 = time.time()
    while time.time() - t0 < a.wait:
        time.sleep(5)
        s = ring.stats()
        print("[%3.0fs] status=%s quadros=%d keyframes=%d fps~%.1f anel=%.1f MB erro=%s"
              % (time.time() - t0, cap.status, s.frames, s.keyframes, s.fps,
                 s.bytes / 1e6, cap.last_error))

    pressed = time.time()
    s = ring.stats()
    queue = MemoryQueue([ClipJob("smoke-%d" % pressed, a.sn, pressed)])
    job = queue.claim_pending(a.sn)[0]
    ok = process_job(job, ring, queue, LocalDirUploader(a.out), fps=a.fps)
    stop.set()

    print("\n== Medidas ==")
    print("fps medido ........ %.1f (usado no MP4: %.1f)" % (s.fps, a.fps))
    if s.span > 0:
        print("bitrate ........... %.2f Mbps" % (s.bytes * 8 / s.span / 1e6))
    if s.keyframes:
        print("keyframes ......... %d em %.0f s (um a cada ~%.1f s)"
              % (s.keyframes, s.span, s.span / s.keyframes))
    print("clipe ............. %s" % (queue.ready or queue.failed))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Conferir que importa e mostra a ajuda**

Run: `cd C:/Codes/Camera_Replay/worker && py -m replay_worker.smoke --help`
Expected: texto de ajuda com `--sn`, `--cameras`, `--wait`, `--fps`, `--out`

- [ ] **Step 3: Criar `worker/cameras.json` a partir do `config.py` antigo (quem tem as credenciais)**

Run (num PC onde exista `C:/Codes/strukti-site/camera/src/config.py`):
```bash
cd C:/Codes/strukti-site/camera/src && py -c "import json,config; json.dump({'cameras':[{'sn':sn,'name':c.get('nome',''),'authcode':c['authcode'],'local_user':c['localuser'],'local_pwd':c['localpwd']} for sn,c in config.CAMERAS.items()]}, open('C:/Codes/Camera_Replay/worker/cameras.json','w'), indent=2)"
```
Expected: `worker/cameras.json` criado (já está no `.gitignore`; confira com `git status` que ele não aparece).

- [ ] **Step 4: Rodar contra a câmera real e anotar as medidas**

Run: `cd C:/Codes/Camera_Replay/worker && py -m replay_worker.smoke --sn <SN> --wait 45`
Expected: o status chega a `online`, `quadros` cresce, e em `out/` aparece um `smoke-*.mp4` que abre no player. Se o status ficar `offline`, copie `erro=` da saída: indica relay/AuthCode/login.

Abra o MP4 e confira: a imagem não está distorcida, a velocidade parece natural (se estiver rápida ou lenta, ajuste `--fps` para o fps medido) e a duração é de cerca de 30 a 32 s.

- [ ] **Step 5: Registrar os achados**

Criar `docs/validacao-camera.md` com este conteúdo, preenchendo os valores medidos (ou escrevendo "não medido" com o motivo):
```markdown
# Validação na câmera real

Data: ____  Câmera: Inova KV-20158 (SN ____)  Comando: `py -m replay_worker.smoke --sn ____ --wait 45`

| Item | Medido | Esperado / ação se diferente |
|---|---|---|
| Relay conecta e fica `online` | | Se não, anotar o `erro=` |
| fps real | | Usar este valor em `fps` do `h264_to_mp4` |
| Bitrate (Mbps) | | Base para o custo de banda 24 h por câmera |
| Intervalo entre keyframes (s) | | Deve ser menor que 10 s para o anel de 40 s sempre ter keyframe |
| 1 fatia por quadro (premissa de `split_access_units`) | | Se o clipe sair com imagem quebrada, tratar multi-fatia |
| Duração do clipe (s) | | 30 a 32 s |
| Sessão cai sozinha? Depois de quanto tempo | | Define a frequência de reconexão |
| App iCSee aberto derruba o worker? | | Registrar como limitação |
```

- [ ] **Step 6: Commit**

```bash
cd C:/Codes/Camera_Replay
git add worker/replay_worker/smoke.py docs/validacao-camera.md
git commit -m "feat(worker): smoke test com a câmera real e roteiro de validação

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Fora deste plano (próximos planos)

- **Backend:** schema Postgres, migrações, API `POST /api/botao/aperto`, implementação real de `JobQueue` (Postgres) e `Uploader` (R2 com `aws4fetch`/boto3), job de limpeza dos clipes expirados, aperto duplo (< 5 s).
- **Web:** site do jogador (`/q/<slug>`) e painel do dono.
- **Loop do worker em produção:** processo que junta `CameraCapture` + polling de `claim_pending` a cada ~1 s + Dockerfile. Depende do Backend e da escolha do host.
- Firmware do ESP32 e cobrança.

## Self-review

- **Cobertura do spec (parte do worker):** anel em memória (T3), corte no keyframe e `parcial` (T3, T7), `ffmpeg -c copy` (T4), reconexão com backoff e offline em 30 s (T6), pedido > 120 s vira `falhou` (T7), retries de upload (T7), interface de fonte trocável (T6), validação de fps, bitrate e relay na câmera real (T8). Itens de Backend, Web, firmware e cobrança estão listados como fora deste plano.
- **Placeholders:** nenhum "TBD"; os campos em branco de `docs/validacao-camera.md` são os valores a medir, não lacunas de implementação.
- **Consistência de tipos:** `Ring.cut -> Cut` (T3) é consumido em `process_job` (T7) com `cut.data`, `cut.duration`, `cut.partial`, `cut.has_gap`; `CameraCreds` (T5) é usado em `config.py` e `source.py` (T6); `split_access_units` (T2) é usado em `capture.py`, `source.py` e `test_mux.py`; `JobQueue.mark_ready(clip_id, key, size, duration, partial)` é igual no Protocol (T7), em `FakeQueue` e em `MemoryQueue`.
- **Contagens de testes:** T2 = 8, T3 = 9, T4 = 3, T5 = 8, T6 = 8, T7 = 9, mais 1 sanidade da T1.

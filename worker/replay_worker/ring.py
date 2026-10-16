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

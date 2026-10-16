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

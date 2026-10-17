"""
clipper.py — transforma um pedido de clipe em um MP4 enviado.

A fila (Postgres) e o armazenamento (R2) entram por Protocol; as implementações
reais vêm no plano do Backend. Aqui só vale o contrato:
  - `process_job` nunca lança: toda falha vira `mark_failed` com um motivo legível;
    se a própria fila falhar (ex.: conexão com o Postgres caiu), a falha é engolida
    e registrada no log só com o tipo da exceção. Quem retoma um clipe preso em
    "processando" é o loop do worker / reaper do Backend (fora deste módulo);
  - clipe curto ou com buraco vira `partial=True` (status `parcial`), não falha.
"""
import logging
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


def _safe_mark_failed(queue: JobQueue, clip_id: str, reason: str) -> None:
    try:
        queue.mark_failed(clip_id, reason)
    except Exception as exc:
        logging.getLogger(__name__).error(
            "falha ao marcar clipe %s como falhou: %s", clip_id, type(exc).__name__)


def process_job(job: ClipJob, ring: Ring, queue: JobQueue, uploader: Uploader, fps: float,
                seconds: float = 30.0, retries: int = 3, max_age: float = 120.0,
                clock=time.time, mux=h264_to_mp4, min_duration: float = 1.0,
                max_stale: float = 30.0) -> bool:
    """Corta, converte e envia. Devolve True se o clipe ficou pronto.

    Nunca lança: qualquer exceção vira `mark_failed`; se a fila também falhar,
    isso é engolido e registrado no log só com o tipo.
    """
    try:
        return _process(job, ring, queue, uploader, fps, seconds, retries, max_age,
                        clock, mux, min_duration, max_stale)
    except Exception as exc:
        _safe_mark_failed(queue, job.clip_id, "erro interno (%s)" % type(exc).__name__)
        return False


def _process(job, ring, queue, uploader, fps, seconds, retries, max_age,
             clock, mux, min_duration, max_stale) -> bool:
    if clock() - job.pressed_at > max_age:
        _safe_mark_failed(queue, job.clip_id, "pedido antigo demais")
        return False

    cut = ring.cut(job.pressed_at, seconds)
    if cut is None:
        _safe_mark_failed(queue, job.clip_id, "sem vídeo no buffer no momento do aperto")
        return False

    if job.pressed_at - cut.end_t > max_stale:
        _safe_mark_failed(queue, job.clip_id, "câmera offline no momento do aperto")
        return False

    if cut.duration < min_duration:
        _safe_mark_failed(queue, job.clip_id, "trecho curto demais")
        return False

    try:
        mp4 = mux(cut.data, fps)
    except MuxError as exc:
        _safe_mark_failed(queue, job.clip_id, "falha no ffmpeg: %s" % str(exc)[:200])
        return False

    key = None
    erro = None
    attempts = max(1, retries)
    for _ in range(attempts):
        try:
            key = uploader.upload(job.clip_id, mp4)
            break
        except Exception as exc:
            erro = exc
    if key is None:
        _safe_mark_failed(queue, job.clip_id, "falha no envio após %d %s (%s)" % (
            attempts, "tentativa" if attempts == 1 else "tentativas", type(erro).__name__))
        return False

    queue.mark_ready(job.clip_id, key, len(mp4), cut.duration, cut.partial or cut.has_gap)
    return True

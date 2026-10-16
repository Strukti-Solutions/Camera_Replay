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

    def run_once(self, stop: threading.Event | None = None) -> None:
        """Uma sessão: conecta, alimenta o anel até a fonte terminar ou falhar."""
        self.session_frames = 0
        source = self._make_source()
        try:
            source.open()
            for chunk in source.chunks():
                if stop is not None and stop.is_set():
                    break
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
                self.run_once(stop)
            except Exception as exc:
                self.last_error = repr(exc)
            failures = 0 if self.session_frames else failures + 1
            wait(self.backoff[min(max(failures, 1) - 1, len(self.backoff) - 1)])

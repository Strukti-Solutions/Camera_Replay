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

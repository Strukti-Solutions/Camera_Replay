"""
source.py — de onde vem o H.264 de uma câmera.

`RelaySource` usa o relay do fabricante. `RtspSource` lê uma câmera com RTSP
na rede local (Yoosee, por exemplo) pelo ffmpeg. `FileSource` simula uma câmera
lendo um arquivo .h264 no ritmo do fps (testes e bancada). Trocar a origem (por
exemplo, DVRIP local atrás de um gateway) não deve mexer no anel nem na captura.
"""
import re
import shutil
import subprocess
import threading
import time
from collections import deque
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


_SENHA_NA_URL = re.compile(r"(rtsp://[^:/@\s]+:)[^@\s]*@")


def ocultar_senha(texto: str) -> str:
    """Troca a senha de qualquer URL rtsp://usuario:senha@ por ***."""
    return _SENHA_NA_URL.sub(r"\1***@", texto)


class RtspSource:
    """Câmera com RTSP local (ex.: Yoosee em rtsp://admin:<senha>@IP:554/onvif1).

    Um processo ffmpeg lê o RTSP por TCP e escreve H.264 Annex-B no stdout. Os
    bytes chegam em pedaços arbitrários: o buffer só libera quadros inteiros
    (o último fica retido até o próximo começar). Com `recodificar=True` o vídeo
    passa pelo libx264 (câmera em H.265 ou keyframe espaçado demais), com
    keyframe a cada 2 s. Nada aqui expõe a senha: repr e erros passam por
    `ocultar_senha`.
    """

    def __init__(self, url: str, recodificar: bool = False, fps: int = 10,
                 ffmpeg: str | None = None, popen=subprocess.Popen,
                 timeout_s: float = 15.0, leitura: int = 65536, transporte: str = "tcp"):
        if transporte not in ("tcp", "udp"):
            raise ValueError("transporte deve ser tcp ou udp")
        self._url = url
        # algumas Yoosee só aceitam UDP ("Nonmatching transport in server reply" no TCP)
        self.transporte = transporte
        self.recodificar = recodificar
        self.fps = fps
        self._ffmpeg = ffmpeg
        self._popen = popen
        self.timeout_s = timeout_s
        self._leitura = leitura
        self._proc = None
        self._dreno: threading.Thread | None = None
        self._erros: deque[str] = deque(maxlen=20)

    def __repr__(self) -> str:
        return "RtspSource(%r, recodificar=%r, transporte=%r)" % (
            ocultar_senha(self._url), self.recodificar, self.transporte)

    def comando(self, ffmpeg: str) -> list[str]:
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
               "-rtsp_transport", self.transporte,
               "-timeout", str(int(self.timeout_s * 1_000_000)),
               "-i", self._url, "-an", "-sn", "-dn"]
        if self.recodificar:
            g = str(max(1, int(self.fps * 2)))
            cmd += ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
                    "-x264-params", "sliced-threads=0",   # 1 fatia por quadro (premissa do h264.py)
                    "-pix_fmt", "yuv420p", "-g", g, "-keyint_min", g, "-sc_threshold", "0"]
        else:
            cmd += ["-c:v", "copy", "-bsf:v", "h264_mp4toannexb"]
        return cmd + ["-flush_packets", "1", "-f", "h264", "pipe:1"]

    def open(self) -> None:
        ff = self._ffmpeg or shutil.which("ffmpeg")
        if not ff:
            raise RuntimeError("ffmpeg não encontrado")
        self._erros.clear()
        try:
            self._proc = self._popen(self.comando(ff), stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except FileNotFoundError:
            raise RuntimeError("ffmpeg não encontrado") from None
        # stderr drenado numa thread para o pipe nunca encher e travar o ffmpeg
        self._dreno = threading.Thread(target=self._drenar_erros, args=(self._proc.stderr,),
                                       daemon=True, name="ffmpeg-stderr")
        self._dreno.start()

    def _drenar_erros(self, stream) -> None:
        try:
            for linha in iter(stream.readline, b""):
                texto = linha.decode("utf-8", "replace").strip()
                if texto:
                    self._erros.append(ocultar_senha(texto))
        except (OSError, ValueError):
            pass

    def chunks(self) -> Iterator[bytes]:
        buf = b""
        while True:
            dados = self._proc.stdout.read1(self._leitura)
            if not dados:
                break
            buf += dados
            aus = split_access_units(buf)
            if len(aus) > 1:
                yield from aus[:-1]
                buf = aus[-1]
        if buf:
            yield from split_access_units(buf)
        codigo = self._proc.wait(timeout=5)
        if codigo:
            self._dreno.join(1.0)   # espera a thread ler o fim do stderr
            if not self.recodificar and any("Codec 'hevc'" in e for e in self._erros):
                raise RuntimeError("câmera em H.265: rode com --recodificar")
            ultimos = " | ".join(list(self._erros)[-3:]) or "sem mensagem"
            raise RuntimeError("ffmpeg saiu com código %s: %s" % (codigo, ultimos[:400]))

    def close(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None or proc.poll() is not None:
            return
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


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

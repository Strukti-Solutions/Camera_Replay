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
        try:
            r = subprocess.run(
                [ff, "-hide_banner", "-loglevel", "error", "-y", "-fflags", "+genpts",
                 "-r", str(fps), "-f", "h264", "-i", "pipe:0", "-c:v", "copy",
                 "-movflags", "+faststart", out],
                input=h264, capture_output=True, timeout=60,
            )
        except subprocess.TimeoutExpired as exc:
            raise MuxError("ffmpeg não respondeu em 60 s") from exc
        except OSError as exc:
            raise MuxError("falha ao executar o ffmpeg: %s" % exc) from exc
        if r.returncode != 0:
            raise MuxError(r.stderr.decode("utf-8", "replace").strip()[:300])
        if not os.path.exists(out) or os.path.getsize(out) == 0:
            raise MuxError("ffmpeg não gerou saída")
        with open(out, "rb") as f:
            return f.read()


def extrair_capa(mp4: bytes, antes_do_fim: float = 3.0, largura: int = 640,
                 ffmpeg: str | None = None) -> bytes:
    """JPEG de um quadro `antes_do_fim` segundos antes do fim do clipe (onde está o lance).

    Erro do ffmpeg lança `MuxError`; quem chama decide se a capa é essencial.
    """
    ff = ffmpeg or find_ffmpeg()
    if not ff:
        raise MuxError("ffmpeg não encontrado")
    with tempfile.TemporaryDirectory() as d:
        entrada = os.path.join(d, "clip.mp4")
        saida = os.path.join(d, "capa.jpg")
        with open(entrada, "wb") as f:
            f.write(mp4)
        try:
            r = subprocess.run(
                [ff, "-hide_banner", "-loglevel", "error", "-y",
                 "-sseof", "-%s" % antes_do_fim, "-i", entrada,
                 "-frames:v", "1", "-vf", "scale=%d:-2" % largura, "-q:v", "5", saida],
                capture_output=True, timeout=30,
            )
        except subprocess.TimeoutExpired as exc:
            raise MuxError("ffmpeg não respondeu em 30 s") from exc
        except OSError as exc:
            raise MuxError("falha ao executar o ffmpeg: %s" % exc) from exc
        if r.returncode != 0:
            raise MuxError(r.stderr.decode("utf-8", "replace").strip()[:300])
        if not os.path.exists(saida) or os.path.getsize(saida) == 0:
            raise MuxError("ffmpeg não gerou a capa")
        with open(saida, "rb") as f:
            return f.read()

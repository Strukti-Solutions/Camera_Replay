import subprocess

import pytest

from replay_worker.mux import MuxError, find_ffmpeg, h264_to_mp4

pytestmark = pytest.mark.skipif(find_ffmpeg() is None, reason="ffmpeg não instalado")


def _mp4_de_teste() -> bytes:
    r = subprocess.run(
        [find_ffmpeg(), "-hide_banner", "-loglevel", "error", "-f", "lavfi",
         "-i", "testsrc=duration=5:size=320x240:rate=15", "-c:v", "libx264",
         "-g", "15", "-f", "h264", "pipe:1"],
        capture_output=True,
    )
    if r.returncode != 0 or not r.stdout:
        pytest.skip("ffmpeg sem libx264")
    return h264_to_mp4(r.stdout, fps=15)


def test_capa_e_jpeg():
    from replay_worker.mux import extrair_capa
    jpg = extrair_capa(_mp4_de_teste())
    assert jpg[:2] == b"\xff\xd8"


def test_lixo_levanta_muxerror():
    from replay_worker.mux import extrair_capa
    with pytest.raises(MuxError):
        extrair_capa(b"isto nao e mp4")

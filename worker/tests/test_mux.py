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

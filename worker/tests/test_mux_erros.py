import subprocess

import pytest

import replay_worker.mux as mux
from replay_worker.mux import MuxError, h264_to_mp4


def test_caminho_de_ffmpeg_inexistente_vira_muxerror():
    with pytest.raises(MuxError):
        h264_to_mp4(b"x", fps=15, ffmpeg="C:/caminho/que/nao/existe/ffmpeg.exe")


def test_timeout_do_ffmpeg_vira_muxerror(monkeypatch):
    def _expira(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=60)

    monkeypatch.setattr(subprocess, "run", _expira)
    with pytest.raises(MuxError, match="não respondeu em 60 s"):
        h264_to_mp4(b"x", fps=15, ffmpeg="ffmpeg")


def test_sem_ffmpeg_no_path_levanta_muxerror(monkeypatch):
    monkeypatch.setattr(mux, "find_ffmpeg", lambda: None)
    with pytest.raises(MuxError, match="ffmpeg não encontrado"):
        h264_to_mp4(b"x", fps=15)

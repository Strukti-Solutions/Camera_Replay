"""Fixtures da simulação: vídeos de teste (gerados uma vez) e o 'aperto' que corta o clipe."""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field

import pytest

from replay_worker.capture import CameraCapture
from replay_worker.clipper import ClipJob, process_job
from replay_worker.local import LocalDirUploader, MemoryQueue
from replay_worker.ring import Ring

from .camera_sim import FFMPEG, FFPROBE, Relogio, gerar_video

if not (FFMPEG and FFPROBE):
    pytest.skip("simulação precisa de ffmpeg e ffprobe no PATH", allow_module_level=True)


@pytest.fixture(scope="session")
def video(tmp_path_factory):
    """150 s a 10 fps, keyframe a cada 4 s: o perfil medido na câmera real."""
    d = tmp_path_factory.mktemp("videos")
    return gerar_video(str(d / "quadra.h264"), 150, fps=10, gop=40)


@pytest.fixture(scope="session")
def video_15fps(tmp_path_factory):
    d = tmp_path_factory.mktemp("videos15")
    return gerar_video(str(d / "quadra15.h264"), 80, fps=15, gop=30)


@pytest.fixture(scope="session")
def video_b(tmp_path_factory):
    """Outra quadra, outra imagem (para provar que os clipes não se misturam)."""
    d = tmp_path_factory.mktemp("videosb")
    return gerar_video(str(d / "quadra_b.h264"), 150, fps=10, gop=40, padrao="testsrc")


@dataclass
class Resultado:
    nome: str
    pressed_at: float
    ok: bool
    fila: MemoryQueue
    pasta: str
    job: ClipJob

    @property
    def pronto(self):
        return self.fila.ready[0] if self.fila.ready else None

    @property
    def falha(self):
        return self.fila.failed[0][1] if self.fila.failed else None

    @property
    def mp4(self) -> str:
        return os.path.join(self.pasta, self.pronto[1])

    @property
    def capa(self) -> str:
        return self.mp4[:-4] + ".jpg"


@dataclass
class Bancada:
    """Uma quadra simulada: câmera + captura + anel + quem processa os apertos."""
    relogio: Relogio
    ring: Ring
    pasta: str
    arena_id: str = "arena-1"
    camera_id: str = "cam-1"
    processar_com_atraso: float = 0.0     # segundos entre o aperto e o worker pegar o pedido
    resultados: dict = field(default_factory=dict)
    esperas: list = field(default_factory=list)
    cap: CameraCapture | None = None
    status_no_aperto: dict = field(default_factory=dict)

    def apertar(self, nome: str, pressed_at: float) -> Resultado:
        job = ClipJob(clip_id=nome, camera_id=self.camera_id, arena_id=self.arena_id,
                      pressed_at=pressed_at)
        fila = MemoryQueue([job])
        job = fila.claim_pending(self.camera_id)[0]
        if self.cap is not None:
            self.status_no_aperto[nome] = self.cap.status
        self.relogio.avancar(self.processar_com_atraso)
        ok = process_job(job, self.ring, fila, LocalDirUploader(self.pasta),
                         fps=None, clock=self.relogio)
        r = Resultado(nome, pressed_at, ok, fila, self.pasta, job)
        self.resultados[nome] = r
        return r

    def rodar(self, camera, max_sessoes: int = 50) -> CameraCapture:
        """Roda a captura até o roteiro da câmera acabar (backoff no relógio virtual)."""
        camera.ao_apertar = self.apertar
        self.cap = CameraCapture(self.camera_id, lambda: camera, self.ring, clock=self.relogio)
        stop = threading.Event()

        def esperar(s):
            self.esperas.append(s)
            self.relogio.avancar(s)
            if camera.roteiro_acabou or len(self.esperas) >= max_sessoes:
                stop.set()

        self.cap.run_forever(stop, wait=esperar)
        return self.cap


@pytest.fixture
def bancada(tmp_path):
    relogio = Relogio()
    return Bancada(relogio=relogio, ring=Ring(), pasta=str(tmp_path / "r2"))

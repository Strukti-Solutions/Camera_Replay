"""
Simulação do worker de produção (Supervisor) com várias quadras ao mesmo tempo:
threads de captura de verdade, relógio acelerado 10x, fila falsa no lugar do
Postgres e pasta local no lugar do R2.
"""
from __future__ import annotations

import os
import threading
import time

import pytest

from replay_worker.clipper import ClipJob
from replay_worker.local import LocalDirUploader
from replay_worker.main import Supervisor
from replay_worker.pg import Camera
from replay_worker.xm.relay import CameraCreds

from .camera_sim import CameraSimulada, RelogioAcelerado, analisar_mp4
from .test_fio_xm import fatia_contigua

ESCALA = 10.0


class FilaFalsa:
    """O que o Supervisor usa do PgJobQueue, em memória."""

    def __init__(self, cameras):
        self.cameras = list(cameras)
        self.pendentes: list[ClipJob] = []
        self.prontos: dict[str, tuple] = {}
        self.falhos: dict[str, str] = {}
        self.status: list[tuple[str, str]] = []
        self._lock = threading.Lock()

    def listar_cameras(self):
        return list(self.cameras)

    def claim_pending(self, camera_id):
        with self._lock:
            meus = [j for j in self.pendentes if j.camera_id == camera_id]
            self.pendentes = [j for j in self.pendentes if j.camera_id != camera_id]
        return meus

    def mark_ready(self, clip_id, key, size, duration, partial):
        self.prontos[clip_id] = (key, size, duration, partial)
        return True

    def mark_failed(self, clip_id, reason):
        self.falhos[clip_id] = reason

    def marcar_camera(self, camera_id, status):
        self.status.append((camera_id, status))

    def ultimo_status(self, camera_id):
        return next((s for c, s in reversed(self.status) if c == camera_id), None)


def camera(cid, arena, senha="senha-1"):
    return Camera(cid, arena, "SN-" + cid, CameraCreds("SN-" + cid, "auth", "user", senha))


@pytest.fixture
def mundo(tmp_path, video, video_b):
    relogio = RelogioAcelerado(ESCALA)
    videos = {"cam-a": video, "cam-b": video_b}
    fontes: dict[str, list[CameraSimulada]] = {"cam-a": [], "cam-b": []}

    def make_source(cam):
        c = CameraSimulada(videos[cam.camera_id], relogio, [[("video", 10_000)]])
        fontes[cam.camera_id].append(c)
        return c

    fila = FilaFalsa([camera("cam-a", "arena-A"), camera("cam-b", "arena-B")])
    pasta = str(tmp_path / "r2")

    def novo_supervisor(relay_lag=0.0):
        return Supervisor(fila, LocalDirUploader(pasta), make_source, clock=relogio,
                          relay_lag=relay_lag, sleep=lambda s: time.sleep(s / ESCALA))

    return relogio, fila, fontes, pasta, novo_supervisor, videos


def esperar_virtual(relogio, segundos, sup=None):
    fim = relogio() + segundos
    while relogio() < fim:
        if sup is not None:
            sup.report_status()
        time.sleep(0.05)


def test_duas_quadras_em_paralelo_cada_clipe_com_a_propria_camera(mundo):
    relogio, fila, fontes, pasta, novo_supervisor, videos = mundo
    sup = novo_supervisor()
    try:
        sup.refresh()
        esperar_virtual(relogio, 38, sup)
        assert fila.ultimo_status("cam-a") == "online"
        assert fila.ultimo_status("cam-b") == "online"

        aperto = relogio()
        fila.pendentes += [ClipJob("clip-a", "cam-a", "arena-A", aperto),
                           ClipJob("clip-b", "cam-b", "arena-B", aperto)]
        assert sup.poll_once() == 2
    finally:
        sup.stop()

    assert fila.falhos == {}
    for clip, cam, arena, outra in [("clip-a", "cam-a", "arena-A", "cam-b"),
                                    ("clip-b", "cam-b", "arena-B", "cam-a")]:
        key, size, dur, parcial = fila.prontos[clip]
        assert key == "clipes/%s/%s.mp4" % (arena, clip)
        assert not parcial
        mp4 = os.path.join(pasta, key)
        assert os.path.exists(mp4[:-4] + ".jpg")
        a = analisar_mp4(mp4)
        assert a.erros_decodificacao == ""
        pos = fatia_contigua(a.md5, videos[cam].md5)
        assert pos in videos[cam].keys
        assert fatia_contigua(a.md5[:10], videos[outra].md5) == -1, "clipe trocou de quadra"
        # cobertura de cena pelos instantes reais (com threads o fps oscila e o MP4 usa o
        # fps arredondado, então a duração do arquivo não mede a cena)
        fonte = fontes[cam][-1]
        chegada = {e.idx: e.t for e in fonte.emitidos}
        # 29,5: o envio do simulador e a chegada no worker diferem por escalonamento (×10)
        assert 29.5 <= chegada[pos + a.quadros - 1] - chegada[pos] <= 34.5
        # o último quadro do clipe é o último que chegou até o aperto
        ultimo = max(e.t for e in fonte.emitidos if e.t <= aperto)
        assert aperto - ultimo < 0.5

    # ao parar, as duas câmeras são marcadas offline
    assert fila.ultimo_status("cam-a") == "offline"
    assert fila.ultimo_status("cam-b") == "offline"


def test_atraso_do_relay_estende_o_corte(mundo):
    """Com RELAY_LAG_S=3 o worker espera o vídeo chegar e corta até aperto + 3 s."""
    relogio, fila, fontes, pasta, novo_supervisor, videos = mundo
    sup = novo_supervisor(relay_lag=3.0)
    try:
        sup.refresh()
        esperar_virtual(relogio, 35)
        aperto = relogio()
        fila.pendentes.append(ClipJob("lag", "cam-a", "arena-A", aperto))
        assert sup.poll_once() == 1
    finally:
        sup.stop()
    fonte = fontes["cam-a"][-1]
    key = fila.prontos["lag"][0]
    a = analisar_mp4(os.path.join(pasta, key))
    pos = fatia_contigua(a.md5, videos["cam-a"].md5)
    ultimo_idx = pos + a.quadros - 1
    t_ultimo = next(e.t for e in fonte.emitidos if e.idx == ultimo_idx)
    assert t_ultimo == pytest.approx(aperto + 3.0, abs=0.5)


def test_camera_removida_para_a_captura_e_fica_offline(mundo):
    relogio, fila, fontes, pasta, novo_supervisor, videos = mundo
    sup = novo_supervisor()
    try:
        sup.refresh()
        esperar_virtual(relogio, 5)
        thread_a = sup._ativas["cam-a"].thread
        fila.cameras = [c for c in fila.cameras if c.camera_id != "cam-b"]
        sup.refresh()
        assert "cam-b" not in sup._ativas
        assert fila.ultimo_status("cam-b") == "offline"
        assert sup._ativas["cam-a"].thread is thread_a, "a outra quadra não pode reiniciar"
        n = len(fontes["cam-b"][-1].emitidos)
        esperar_virtual(relogio, 3)
        assert len(fontes["cam-b"][-1].emitidos) <= n + 1, "câmera removida continuou capturando"
    finally:
        sup.stop()


def test_credencial_trocada_reinicia_so_aquela_captura(mundo):
    relogio, fila, fontes, pasta, novo_supervisor, videos = mundo
    sup = novo_supervisor()
    try:
        sup.refresh()
        esperar_virtual(relogio, 5)
        thread_a, thread_b = sup._ativas["cam-a"].thread, sup._ativas["cam-b"].thread
        fila.cameras = [camera("cam-a", "arena-A", senha="nova"), camera("cam-b", "arena-B")]
        sup.refresh()
        assert sup._ativas["cam-a"].thread is not thread_a
        assert not thread_a.is_alive()
        assert sup._ativas["cam-b"].thread is thread_b
        assert len(fontes["cam-a"]) == 2
    finally:
        sup.stop()


def test_aperto_de_camera_sem_video_falha_sem_travar_a_outra(mundo, tmp_path):
    relogio, fila, fontes, pasta, novo_supervisor, videos = mundo
    sup = novo_supervisor()
    try:
        sup.refresh()
        esperar_virtual(relogio, 34)
        aperto = relogio()
        # pedido de 3 minutos atrás (fora do anel e velho demais) + um pedido normal
        fila.pendentes += [ClipJob("velho", "cam-b", "arena-B", aperto - 180),
                           ClipJob("bom", "cam-a", "arena-A", aperto)]
        assert sup.poll_once() == 1
    finally:
        sup.stop()
    assert fila.falhos == {"velho": "pedido antigo demais"}
    assert "bom" in fila.prontos

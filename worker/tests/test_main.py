import threading
import time

import pytest

from replay_worker import main as main_mod
from replay_worker.clipper import ClipJob
from replay_worker.main import Supervisor
from replay_worker.pg import Camera
from replay_worker.xm.relay import CameraCreds
from tests.helpers import KEY, P, feed


def cam(i, arena="arena1"):
    return Camera("cam%d" % i, arena, "SN%d" % i, CameraCreds("SN%d" % i, "a", "u", "p"))


class FilaFalsa:
    def __init__(self, cameras=()):
        self.cameras = list(cameras)
        self.jobs = {}          # camera_id -> [ClipJob]
        self.pronto = []
        self.falhou = []
        self.status = []
        self.erro_em = set()

    def listar_cameras(self):
        return list(self.cameras)

    def claim_pending(self, camera_id):
        if camera_id in self.erro_em:
            raise RuntimeError("banco caiu")
        return self.jobs.pop(camera_id, [])

    def mark_ready(self, clip_id, key, size, duration, partial):
        self.pronto.append((clip_id, key))
        return True

    def mark_failed(self, clip_id, reason):
        self.falhou.append((clip_id, reason))

    def marcar_camera(self, camera_id, status):
        self.status.append((camera_id, status))


class EnvioFalso:
    def __init__(self):
        self.puts = []

    def put(self, key, data):
        self.puts.append(key)

    def delete(self, key):
        pass


class Parada:
    """Fonte que fica ociosa até ser fechada, sem entregar vídeo."""
    def __init__(self, chunks=()):
        self._chunks = list(chunks)
        self._fim = threading.Event()

    def open(self):
        pass

    def chunks(self):
        yield from self._chunks
        self._fim.wait(0.3)

    def close(self):
        self._fim.set()


class Relogio:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def mux_falso(h264, fps):
    return b"mp4"


@pytest.fixture
def sup_factory():
    criados = []

    def fazer(fila, **kw):
        kw.setdefault("make_source", lambda c: Parada())
        kw.setdefault("clock", Relogio())
        kw.setdefault("mux", mux_falso)
        s = Supervisor(fila, EnvioFalso(), **kw)
        criados.append(s)
        return s
    yield fazer
    for s in criados:
        s.stop()


def ring_de(sup, camera_id):
    return sup._ativas[camera_id].capture.ring


def test_refresh_sobe_para_e_nao_recria(sup_factory):
    fila = FilaFalsa([cam(1), cam(2)])
    sup = sup_factory(fila)
    sup.refresh()
    assert set(sup._ativas) == {"cam1", "cam2"}
    antes = sup._ativas["cam1"]
    fila.cameras = [cam(1)]
    sup.refresh()
    assert set(sup._ativas) == {"cam1"}
    assert sup._ativas["cam1"] is antes
    assert antes.thread.is_alive()


def test_refresh_para_a_thread_da_camera_removida(sup_factory):
    fila = FilaFalsa([cam(1), cam(2)])
    sup = sup_factory(fila)
    sup.refresh()
    removida = sup._ativas["cam2"]
    fila.cameras = [cam(1)]
    sup.refresh()
    assert not removida.thread.is_alive()


def test_clipe_pendente_vira_put_e_mark_ready(sup_factory):
    fila = FilaFalsa([cam(1)])
    sup = sup_factory(fila)
    sup.refresh()
    feed(ring_de(sup, "cam1"), 40, start=960.0)
    fila.jobs["cam1"] = [ClipJob("clipe9", "cam1", "arena1", 1000.0)]
    assert sup.poll_once() == 1
    assert sup._uploader.puts == ["clipes/arena1/clipe9.mp4"]
    assert fila.pronto == [("clipe9", "clipes/arena1/clipe9.mp4")]


def test_relay_lag_espera_o_relogio_passar(sup_factory):
    rel = Relogio(1000.0)
    cortes = []

    def dorme(s):
        rel.t += s

    fila = FilaFalsa([cam(1)])
    sup = sup_factory(fila, clock=rel, relay_lag=2.0, sleep=dorme)
    sup.refresh()
    ring = ring_de(sup, "cam1")
    feed(ring, 40, start=960.0)
    original = ring.cut
    fim_do_corte = []

    def cut_espiao(end_t, *a, **k):
        cortes.append(rel.t)
        fim_do_corte.append(end_t)
        return original(end_t, *a, **k)

    ring.cut = cut_espiao
    fila.jobs["cam1"] = [ClipJob("c1", "cam1", "arena1", 1000.0)]
    assert sup.poll_once() == 1
    assert cortes and cortes[0] >= 1002.0
    # o anel guarda a chegada: o corte termina no aperto + atraso do relay
    assert sup._uploader.puts == ["clipes/arena1/c1.mp4"]
    assert fim_do_corte == [1002.0]


def test_relay_lag_espera_no_maximo_10s(sup_factory):
    rel = Relogio(1000.0)
    fila = FilaFalsa([cam(1)])
    sup = sup_factory(fila, clock=rel, relay_lag=60.0, sleep=lambda s: setattr(rel, "t", rel.t + s))
    sup.refresh()
    feed(ring_de(sup, "cam1"), 40, start=960.0)
    fila.jobs["cam1"] = [ClipJob("c1", "cam1", "arena1", 1000.0)]
    sup.poll_once()
    assert rel.t <= 1010.0 + 1e-6


def test_camera_removida_no_refresh_recebe_offline(sup_factory):
    fila = FilaFalsa([cam(1), cam(2)])
    sup = sup_factory(fila)
    sup.refresh()
    fila.cameras = [cam(1)]
    sup.refresh()
    assert ("cam2", "offline") in fila.status
    assert ("cam1", "offline") not in fila.status


def test_erro_ao_marcar_offline_nao_impede_parar_o_resto(sup_factory):
    fila = FilaFalsa([cam(1), cam(2)])

    def marcar_ruim(camera_id, status):
        raise RuntimeError("banco caiu")

    fila.marcar_camera = marcar_ruim
    sup = sup_factory(fila)
    sup.refresh()
    removida = sup._ativas["cam2"]
    fila.cameras = [cam(1)]
    sup.refresh()
    assert not removida.thread.is_alive()
    assert set(sup._ativas) == {"cam1"}


def test_stop_marca_as_cameras_offline(sup_factory):
    fila = FilaFalsa([cam(1)])
    sup = sup_factory(fila)
    sup.refresh()
    sup.stop()
    assert ("cam1", "offline") in fila.status


def test_kwargs_de_conexao_tem_timeouts_e_keepalive():
    kw = main_mod._kwargs_conexao()
    assert kw["autocommit"] is True
    assert kw["connect_timeout"] == 10
    assert kw["keepalives"] == 1 and kw["keepalives_idle"] == 30
    assert kw["keepalives_interval"] == 10 and kw["keepalives_count"] == 3
    assert kw["options"] == "-c statement_timeout=15000"


def test_erro_da_fila_numa_camera_nao_impede_a_outra(sup_factory):
    fila = FilaFalsa([cam(1), cam(2)])
    fila.erro_em = {"cam1"}
    sup = sup_factory(fila)
    sup.refresh()
    feed(ring_de(sup, "cam2"), 40, start=960.0)
    fila.jobs["cam2"] = [ClipJob("c2", "cam2", "arena1", 1000.0)]
    assert sup.poll_once() == 1
    assert fila.pronto == [("c2", "clipes/arena1/c2.mp4")]


def test_report_status_online_e_offline(sup_factory):
    fila = FilaFalsa([cam(1), cam(2)])
    rel = Relogio(1000.0)
    sup = sup_factory(fila, clock=rel,
                      make_source=lambda c: Parada([KEY, P]) if c.camera_id == "cam1" else Parada())
    sup.refresh()
    for _ in range(200):
        if sup._ativas["cam1"].capture.session_frames:
            break
        time.sleep(0.01)
    sup.report_status()
    assert dict(fila.status) == {"cam1": "online", "cam2": "offline"}


def test_main_sem_database_url_sai_com_erro_sem_vazar_valores(monkeypatch, capsys):
    for k in ("DATABASE_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
              "R2_BUCKET", "CAMERA_CRED_KEY", "RELAY_LAG_S", "WORKER_POLL_S"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "SEGREDO-DO-R2")
    monkeypatch.setenv("CAMERA_CRED_KEY", "SEGREDO-DA-CHAVE")
    assert main_mod.main() != 0
    saida = capsys.readouterr()
    texto = saida.out + saida.err
    assert "DATABASE_URL" in texto
    assert "SEGREDO" not in texto

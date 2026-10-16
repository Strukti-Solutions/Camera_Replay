import threading

from replay_worker.capture import CameraCapture
from replay_worker.ring import Ring
from tests.helpers import KEY, P


class FakeSource:
    def __init__(self, chunks=(), fail_open=False):
        self._chunks = list(chunks)
        self._fail_open = fail_open
        self.closed = False

    def open(self):
        if self._fail_open:
            raise RuntimeError("câmera offline")

    def chunks(self):
        yield from self._chunks

    def close(self):
        self.closed = True


class Relogio:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def test_run_once_alimenta_o_anel_e_fecha_a_fonte():
    ring = Ring()
    src = FakeSource([KEY + P, P])
    cap = CameraCapture("cam1", lambda: src, ring, clock=Relogio())
    cap.run_once()
    assert len(ring) == 3
    assert cap.session_frames == 3
    assert cap.status == "online"
    assert src.closed


def test_status_vira_offline_sem_video_por_30s():
    rel = Relogio()
    cap = CameraCapture("cam1", lambda: FakeSource([KEY]), Ring(), clock=rel)
    assert cap.status == "offline"          # nunca recebeu vídeo
    cap.run_once()
    assert cap.status == "online"
    rel.t += 31
    assert cap.status == "offline"


def test_reconecta_com_backoff_e_zera_apos_sucesso():
    fontes = iter([
        FakeSource(fail_open=True),
        FakeSource(fail_open=True),
        FakeSource(fail_open=True),
        FakeSource([KEY, P]),            # sucesso: entrega vídeo e termina
    ])
    stop = threading.Event()
    esperas = []

    def wait(delay):
        esperas.append(delay)
        if len(esperas) == 4:
            stop.set()
        return stop.is_set()

    cap = CameraCapture("cam1", lambda: next(fontes), Ring(), clock=Relogio())
    cap.run_forever(stop, wait=wait)
    assert esperas == [1, 2, 4, 1]
    assert "câmera offline" in cap.last_error


def test_backoff_para_no_teto_de_60s():
    fontes = iter([FakeSource(fail_open=True) for _ in range(12)])
    stop = threading.Event()
    esperas = []

    def wait(delay):
        esperas.append(delay)
        if len(esperas) == 12:
            stop.set()
        return stop.is_set()

    cap = CameraCapture("cam1", lambda: next(fontes), Ring(), clock=Relogio())
    cap.run_forever(stop, wait=wait)
    assert esperas == [1, 2, 4, 8, 16, 32, 60, 60, 60, 60, 60, 60]


def test_stop_interrompe_sessao_ativa_e_fecha_a_fonte():
    stop = threading.Event()

    class Infinita(FakeSource):
        def chunks(self):
            n = 0
            while True:
                yield KEY
                n += 1
                if n == 3:
                    stop.set()

    ring = Ring()
    src = Infinita()
    cap = CameraCapture("cam1", lambda: src, ring, clock=Relogio())
    cap.run_once(stop)
    assert src.closed
    assert len(ring) <= 3


def test_run_forever_com_stop_ja_setado_nao_cria_fonte():
    stop = threading.Event()
    stop.set()
    chamadas = []
    cap = CameraCapture("cam1", lambda: chamadas.append(1), Ring(), clock=Relogio())
    cap.run_forever(stop, wait=lambda d: True)
    assert chamadas == []

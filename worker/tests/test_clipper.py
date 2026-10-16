from replay_worker.clipper import ClipJob, process_job
from replay_worker.mux import MuxError
from replay_worker.ring import Ring
from tests.helpers import KEY, P, feed


class FakeQueue:
    def __init__(self):
        self.ready = []
        self.failed = []

    def mark_ready(self, clip_id, key, size, duration, partial):
        self.ready.append((clip_id, key, size, duration, partial))

    def mark_failed(self, clip_id, reason):
        self.failed.append((clip_id, reason))


class FakeUploader:
    def __init__(self, falhas=0):
        self.falhas = falhas
        self.chamadas = 0

    def upload(self, clip_id, mp4):
        self.chamadas += 1
        if self.chamadas <= self.falhas:
            raise OSError("rede")
        return "clips/%s.mp4" % clip_id


def mux_ok(h264, fps):
    return b"MP4"


def job(pressed_at=59.0):
    return ClipJob("c1", "cam1", pressed_at)


def anel_cheio():
    ring = Ring()
    feed(ring, 60)
    return ring


def run(ring, queue, uploader, j=None, mux=mux_ok, clock=lambda: 60.0):
    return process_job(j or job(), ring, queue, uploader, fps=15, mux=mux, clock=clock)


def test_sucesso_envia_e_marca_pronto():
    q = FakeQueue()
    assert run(anel_cheio(), q, FakeUploader())
    assert q.ready == [("c1", "clips/c1.mp4", 3, 39.0, False)]
    assert q.failed == []


def test_anel_vazio_marca_falhou_sem_lancar():
    q = FakeQueue()
    assert not run(Ring(), q, FakeUploader())
    assert q.failed and "sem vídeo" in q.failed[0][1]


def test_so_quadros_p_marca_falhou():
    ring = Ring()
    ring.append(58.0, P)
    ring.append(59.0, P)
    q = FakeQueue()
    assert not run(ring, q, FakeUploader())
    assert q.failed[0][0] == "c1"


def test_anel_curto_sai_parcial():
    ring = Ring()
    feed(ring, 15)
    q = FakeQueue()
    assert run(ring, q, FakeUploader(), j=job(14.0), clock=lambda: 15.0)
    assert q.ready[0][4] is True


def test_buraco_tambem_sai_parcial():
    ring = Ring(keep_seconds=100.0)
    feed(ring, 10)
    feed(ring, 10, start=20.0)
    q = FakeQueue()
    assert run(ring, q, FakeUploader(), j=job(29.0), clock=lambda: 30.0)
    assert q.ready[0][4] is True


def test_upload_falha_duas_vezes_e_depois_funciona():
    q = FakeQueue()
    up = FakeUploader(falhas=2)
    assert run(anel_cheio(), q, up)
    assert up.chamadas == 3 and q.ready


def test_upload_falha_sempre_marca_falhou_apos_3_tentativas():
    q = FakeQueue()
    up = FakeUploader(falhas=99)
    assert not run(anel_cheio(), q, up)
    assert up.chamadas == 3
    assert "envio" in q.failed[0][1]


def test_muxerror_marca_falhou():
    def mux_ruim(h264, fps):
        raise MuxError("ffmpeg quebrou")

    q = FakeQueue()
    assert not run(anel_cheio(), q, FakeUploader(), mux=mux_ruim)
    assert "ffmpeg" in q.failed[0][1]


def test_pedido_antigo_demais_falha_sem_cortar():
    q = FakeQueue()
    assert not run(anel_cheio(), q, FakeUploader(), clock=lambda: 59.0 + 121.0)
    assert "antigo" in q.failed[0][1]


def test_excecao_inesperada_do_mux_marca_falhou():
    def mux_ruim(h264, fps):
        raise ValueError("x")

    q = FakeQueue()
    assert not run(anel_cheio(), q, FakeUploader(), mux=mux_ruim)
    assert q.failed[0][1] == "erro interno (ValueError)"


def test_mark_ready_levantando_nao_propaga_e_marca_falhou():
    class QueueRuim(FakeQueue):
        def mark_ready(self, *a):
            raise ConnectionError("banco caiu")

    q = QueueRuim()
    assert not run(anel_cheio(), q, FakeUploader())
    assert q.failed and "ConnectionError" in q.failed[0][1]


def test_mark_failed_levantando_tambem_nao_propaga():
    class QueueRuim(FakeQueue):
        def mark_failed(self, *a):
            raise ConnectionError("banco caiu")

    assert not run(Ring(), QueueRuim(), FakeUploader())


def test_motivo_do_envio_nao_vaza_segredo():
    class UpRuim:
        def upload(self, clip_id, mp4):
            raise OSError("https://bucket.r2.example/x?X-Amz-Signature=SEGREDO")

    q = FakeQueue()
    assert not run(anel_cheio(), q, UpRuim())
    motivo = q.failed[0][1]
    assert "SEGREDO" not in motivo and "X-Amz" not in motivo and "OSError" in motivo


def test_clipe_de_um_quadro_falha_por_curto():
    ring = Ring()
    ring.append(59.0, KEY)
    q = FakeQueue()
    up = FakeUploader()
    assert not run(ring, q, up)
    assert "curto" in q.failed[0][1] and up.chamadas == 0

from replay_worker.clipper import ClipJob, chave_do_clipe, process_job
from replay_worker.mux import MuxError
from replay_worker.ring import Ring
from tests.helpers import KEY, P, feed


class FakeQueue:
    def __init__(self, aceita=True):
        self.ready = []
        self.failed = []
        self.aceita = aceita

    def mark_ready(self, clip_id, key, size, duration, partial):
        self.ready.append((clip_id, key, size, duration, partial))
        return self.aceita

    def mark_failed(self, clip_id, reason):
        self.failed.append((clip_id, reason))


class FakeUploader:
    def __init__(self, falhas=0):
        self.falhas = falhas
        self.chamadas = 0
        self.puts = []
        self.deletes = []
        self.delete_falha = False

    def put(self, key, data):
        self.chamadas += 1
        if self.chamadas <= self.falhas:
            raise OSError("rede")
        self.puts.append((key, data))

    def delete(self, key):
        self.deletes.append(key)
        if self.delete_falha:
            raise OSError("r2 fora")


def mux_ok(h264, fps):
    return b"MP4"


def job(pressed_at=59.0):
    return ClipJob("c1", "cam1", "arena1", pressed_at)


def anel_cheio():
    ring = Ring()
    feed(ring, 60)
    return ring


def run(ring, queue, uploader, j=None, mux=mux_ok, clock=lambda: 60.0):
    return process_job(j or job(), ring, queue, uploader, fps=15, mux=mux, clock=clock)


def test_sucesso_envia_e_marca_pronto():
    q = FakeQueue()
    assert run(anel_cheio(), q, FakeUploader())
    assert q.ready == [("c1", "clipes/arena1/c1.mp4", 3, 39.0, False)]
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
        def put(self, key, data):
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


def test_camera_offline_no_aperto_falha_sem_enviar():
    up = FakeUploader()
    q = FakeQueue()
    assert not run(anel_cheio(), q, up, j=job(200.0), clock=lambda: 201.0)
    assert "offline" in q.failed[0][1]
    assert up.chamadas == 0 and q.ready == []


def test_max_stale_na_fronteira_e_inclusivo():
    # último quadro do anel em t=59; defasagem de exatamente 30 s ainda é aceita
    q = FakeQueue()
    assert run(anel_cheio(), q, FakeUploader(), j=job(89.0), clock=lambda: 90.0)
    assert q.ready and q.failed == []


def test_max_stale_acima_do_limite_marca_offline():
    q = FakeQueue()
    assert not run(anel_cheio(), q, FakeUploader(), j=job(89.5), clock=lambda: 90.0)
    assert "offline" in q.failed[0][1]


def test_mensagem_de_envio_usa_singular_com_uma_tentativa():
    q = FakeQueue()
    process_job(job(), anel_cheio(), q, FakeUploader(falhas=99), fps=15,
                mux=mux_ok, clock=lambda: 60.0, retries=1)
    assert "após 1 tentativa " in q.failed[0][1]


def test_mensagem_de_envio_usa_plural_com_varias_tentativas():
    q = FakeQueue()
    assert not run(anel_cheio(), q, FakeUploader(falhas=99))
    assert "após 3 tentativas" in q.failed[0][1]


def test_chave_do_contrato_e_a_mesma_do_mark_ready():
    q, up = FakeQueue(), FakeUploader()
    assert run(anel_cheio(), q, up)
    assert up.puts == [("clipes/arena1/c1.mp4", b"MP4")]
    assert q.ready[0][1] == up.puts[0][0]
    assert chave_do_clipe(job()) == "clipes/arena1/c1.mp4"


def test_mark_ready_false_apaga_o_objeto_e_devolve_false():
    q, up = FakeQueue(aceita=False), FakeUploader()
    assert run(anel_cheio(), q, up) is False
    assert up.deletes == ["clipes/arena1/c1.mp4"]
    assert q.failed == []


def test_mark_ready_false_com_delete_falhando_nao_lanca_e_loga_so_o_id(caplog):
    q, up = FakeQueue(aceita=False), FakeUploader()
    up.delete_falha = True
    assert run(anel_cheio(), q, up) is False
    assert "r2 fora" not in caplog.text and "clipes/" not in caplog.text
    assert "c1" in caplog.text


class QueueQueLanca(FakeQueue):
    def mark_ready(self, *a):
        raise ConnectionError("banco caiu")


def test_mark_ready_levantando_apaga_o_objeto_e_marca_falhou():
    q, up = QueueQueLanca(), FakeUploader()
    assert run(anel_cheio(), q, up) is False
    assert up.deletes == ["clipes/arena1/c1.mp4"]
    assert "ConnectionError" in q.failed[0][1]


def test_mark_ready_levantando_com_delete_falhando_ainda_marca_falhou():
    q, up = QueueQueLanca(), FakeUploader()
    up.delete_falha = True
    assert run(anel_cheio(), q, up) is False
    assert "ConnectionError" in q.failed[0][1]


def _fps_usado(ring, t, min_duration=1.0):
    vistos = []
    process_job(ClipJob("c1", "cam1", "arena1", t), ring, FakeQueue(), FakeUploader(),
                mux=lambda h, f: vistos.append(f) or b"MP4", clock=lambda: t,
                min_duration=min_duration)
    return vistos


def test_fps_none_usa_o_medido_do_anel_arredondado():
    ring = Ring()
    for i in range(60):
        ring.append(i / 14.7, KEY if i % 10 == 0 else P)
    assert _fps_usado(ring, 59 / 14.7) == [15]


def test_fps_none_sem_medida_usa_15():
    ring = Ring()
    ring.append(59.0, KEY)          # um quadro só: o anel não tem fps medido
    assert _fps_usado(ring, 59.0, min_duration=0.0) == [15]


def test_fps_none_limitado_entre_1_e_60():
    ring = Ring()
    for i in range(300):
        ring.append(i / 120.0, KEY if i % 10 == 0 else P)   # ~120 fps
    assert _fps_usado(ring, 299 / 120.0) == [60]
    lento = Ring()
    for i in range(20):
        lento.append(i * 4.0, KEY if i % 5 == 0 else P)     # 0,25 fps
    assert _fps_usado(lento, 19 * 4.0, min_duration=0.0) == [1]

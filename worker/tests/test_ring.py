from replay_worker.h264 import split_access_units
from replay_worker.ring import Ring
from tests.helpers import KEY, P, feed


def test_corta_30s_a_partir_do_keyframe_anterior():
    ring = Ring(keep_seconds=40.0)
    feed(ring, 60)                      # t = 0..59, keyframes em 0,10,...,50
    cut = ring.cut(59.0, 30.0)
    assert cut is not None
    assert cut.start_t == 20.0          # último keyframe com t <= 59 - 30
    assert cut.end_t == 59.0
    assert cut.duration == 39.0
    assert not cut.partial and not cut.has_gap
    assert len(split_access_units(cut.data)) == 40


def test_ignora_quadros_depois_do_fim_pedido():
    ring = Ring(keep_seconds=100.0)
    feed(ring, 60)
    cut = ring.cut(40.0, 30.0)
    assert cut.start_t == 10.0
    assert cut.end_t == 40.0
    assert cut.duration == 30.0
    assert not cut.partial


def test_anel_curto_vira_clipe_parcial():
    ring = Ring()
    feed(ring, 15)                      # só 14 s de vídeo
    cut = ring.cut(14.0, 30.0)
    assert cut.partial
    assert cut.start_t == 0.0
    assert cut.duration == 14.0


def test_vazio_ou_sem_keyframe_devolve_none():
    ring = Ring()
    assert ring.cut(10.0) is None
    ring.append(1.0, P)
    ring.append(2.0, P)
    assert ring.cut(2.0) is None


def test_buraco_no_meio_marca_has_gap():
    ring = Ring(keep_seconds=100.0)
    feed(ring, 10)                      # t = 0..9
    feed(ring, 10, start=20.0)          # t = 20..29
    cut = ring.cut(29.0, 30.0)
    assert cut.has_gap


def test_fluxo_morto_no_instante_do_aperto_marca_has_gap():
    ring = Ring()
    feed(ring, 10)                      # último quadro em t = 9
    cut = ring.cut(20.0, 30.0)
    assert cut.has_gap


def test_teto_de_bytes_limita_o_anel():
    ring = Ring(keep_seconds=10_000.0, max_bytes=100)
    for i in range(50):
        ring.append(float(i), P)
    assert ring.size_bytes <= 100
    assert len(ring) >= 1


def test_stats():
    ring = Ring(keep_seconds=40.0)
    feed(ring, 60)
    s = ring.stats()
    assert s.frames == 41               # t = 19..59
    assert s.keyframes == 4             # t = 20,30,40,50
    assert s.span == 40.0
    assert s.fps == 1.0
    assert s.bytes == ring.size_bytes


def test_append_vazio_e_ignorado():
    ring = Ring()
    ring.append(1.0, b"")
    assert len(ring) == 0

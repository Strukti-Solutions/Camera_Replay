"""QA: casos de borda ainda não cobertos. Afirmam o comportamento correto."""
import json

import pytest

from replay_worker.clipper import ClipJob, process_job
from replay_worker.config import load_cameras
from replay_worker.ring import Ring
from replay_worker.xm.wire import NetIPReader, dewrap
from tests.helpers import KEY, P, feed
from tests.test_clipper import FakeQueue, FakeUploader, mux_ok
from tests.test_xm_wire import FakeSock


def test_cut_com_fim_anterior_a_todos_os_quadros_devolve_none():
    ring = Ring()
    feed(ring, 20, start=100.0)
    assert ring.cut(50.0, 30.0) is None


def test_aparo_por_bytes_que_descarta_o_keyframe_nao_gera_corte_sem_keyframe():
    ring = Ring(keep_seconds=1000.0, max_bytes=len(KEY) + 2 * len(P))
    ring.append(0.0, KEY)
    for i in range(1, 6):
        ring.append(float(i), P)      # o aparo expulsa o único keyframe
    cut = ring.cut(5.0, 30.0)
    assert cut is None or cut.data.startswith(KEY), \
        "corte começa num quadro P: não decodifica"


def test_netip_fluxo_termina_no_meio_do_cabecalho_devolve_none():
    pkt = b"\xff\x01" + b"\x00" * 6        # 8 dos 20 bytes do cabeçalho
    r = NetIPReader(FakeSock([pkt]))
    assert r.read() is None


def test_dewrap_marcador_truncado_so_o_marcador_devolve_vazio():
    assert dewrap(b"\x00\x00\x01\xfc") == b""
    assert dewrap(b"\x00\x00\x01\xfd\x01\x02\x03\x04" + b"\x00\x00\x00\x01\x01\x11"
                  + b"\x00\x00\x01\xfc") == b"\x00\x00\x00\x01\x01\x11"


def test_process_job_com_retries_zero_tenta_uma_vez():
    ring = Ring()
    feed(ring, 60)
    q, up = FakeQueue(), FakeUploader()
    ok = process_job(ClipJob("c1", "cam1", "arena1", 59.0), ring, q, up, fps=15,
                     mux=mux_ok, clock=lambda: 60.0, retries=0)
    assert ok is True and up.chamadas == 1 and q.failed == []


def test_process_job_com_retries_zero_e_envio_falho_tem_motivo_legivel():
    ring = Ring()
    feed(ring, 60)
    q, up = FakeQueue(), FakeUploader(falhas=99)
    ok = process_job(ClipJob("c1", "cam1", "arena1", 59.0), ring, q, up, fps=15,
                     mux=mux_ok, clock=lambda: 60.0, retries=0)
    assert ok is False and up.chamadas == 1
    assert "NoneType" not in q.failed[0][1]


@pytest.mark.parametrize("sn", [123, ["a"], {"x": 1}])
def test_load_cameras_sn_que_nao_e_string_levanta_valueerror(tmp_path, sn):
    p = tmp_path / "cameras.json"
    p.write_text(json.dumps({"cameras": [{"sn": sn, "authcode": "a",
                                          "local_user": "u", "local_pwd": "p"}]}))
    with pytest.raises(ValueError):
        load_cameras(str(p))

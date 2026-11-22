import json

import pytest

from replay_worker.pg import Camera
from replay_worker.rtsp_local import carregar_rtsp, fonte_para
from replay_worker.source import RtspSource
from replay_worker.xm.relay import CameraCreds

URL = "rtsp://admin:s3nh4@192.168.0.108:554/onvif1"


def _arquivo(tmp_path, cameras):
    p = tmp_path / "cameras-rtsp.json"
    p.write_text(json.dumps({"cameras": cameras}), encoding="utf-8")
    return str(p)


def _cam(sn):
    return Camera("id-" + sn, "arena", sn, CameraCreds(sn, "a", "u", "p"))


def test_le_a_url_da_variavel_de_ambiente(tmp_path):
    p = _arquivo(tmp_path, [{"sn": "JORTAN-1", "url_env": "URL_JORTAN", "udp": True,
                             "recodificar": True}])
    m = carregar_rtsp(p, {"URL_JORTAN": URL})
    assert m["JORTAN-1"].url == URL
    assert m["JORTAN-1"].udp is True
    assert m["JORTAN-1"].recodificar is True


def test_padroes_tcp_e_sem_recodificar(tmp_path):
    p = _arquivo(tmp_path, [{"sn": "C1", "url_env": "U"}])
    c = carregar_rtsp(p, {"U": URL})["C1"]
    assert (c.udp, c.recodificar) == (False, False)


def test_variavel_ausente_cita_o_nome_e_nao_o_valor(tmp_path):
    p = _arquivo(tmp_path, [{"sn": "C1", "url_env": "URL_QUE_FALTA"}])
    with pytest.raises(ValueError, match="URL_QUE_FALTA"):
        carregar_rtsp(p, {})


def test_url_que_nao_e_rtsp_e_recusada_sem_vazar(tmp_path):
    p = _arquivo(tmp_path, [{"sn": "C1", "url_env": "U"}])
    with pytest.raises(ValueError) as exc:
        carregar_rtsp(p, {"U": "http://admin:s3nh4@x/"})
    assert "s3nh4" not in str(exc.value)


def test_sn_duplicado_e_recusado(tmp_path):
    p = _arquivo(tmp_path, [{"sn": "C1", "url_env": "U"}, {"sn": "C1", "url_env": "U"}])
    with pytest.raises(ValueError, match="duplicado"):
        carregar_rtsp(p, {"U": URL})


def test_repr_nao_mostra_a_senha(tmp_path):
    p = _arquivo(tmp_path, [{"sn": "C1", "url_env": "U"}])
    assert "s3nh4" not in repr(carregar_rtsp(p, {"U": URL}))


def test_fonte_para_camera_listada_e_rtsp(tmp_path):
    p = _arquivo(tmp_path, [{"sn": "C1", "url_env": "U", "udp": True, "recodificar": True}])
    m = carregar_rtsp(p, {"U": URL})
    src = fonte_para(_cam("C1"), m, relay=lambda c: pytest.fail("não deveria usar o relay"))
    assert isinstance(src, RtspSource)
    assert (src.transporte, src.recodificar) == ("udp", True)


def test_fonte_para_camera_fora_da_lista_usa_o_relay():
    usado = []
    fonte_para(_cam("XM1"), {}, relay=lambda c: usado.append(c.sn))
    assert usado == ["XM1"]

import json

import pytest

from replay_worker.config import load_cameras


def test_carrega_cameras_por_sn(tmp_path):
    p = tmp_path / "cameras.json"
    p.write_text(json.dumps({"cameras": [
        {"sn": "S1", "name": "Quadra 1", "authcode": "A", "local_user": "u", "local_pwd": "p"},
    ]}), encoding="utf-8")
    cams = load_cameras(str(p))
    assert cams["S1"].authcode == "A"
    assert cams["S1"].local_user == "u"
    assert cams["S1"].name == "Quadra 1"


def test_campo_faltando_da_erro_claro(tmp_path):
    p = tmp_path / "cameras.json"
    p.write_text(json.dumps({"cameras": [{"sn": "S1"}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="S1"):
        load_cameras(str(p))

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


def _escreve(tmp_path, conteudo):
    p = tmp_path / "cameras.json"
    p.write_text(json.dumps(conteudo), encoding="utf-8")
    return str(p)


def test_sn_duplicado_da_erro(tmp_path):
    item = {"sn": "S1", "authcode": "A", "local_user": "u", "local_pwd": "p"}
    with pytest.raises(ValueError, match="S1"):
        load_cameras(_escreve(tmp_path, {"cameras": [item, dict(item)]}))


@pytest.mark.parametrize("conteudo", [{}, [], {"cameras": ["x"]}, {"cameras": "x"}])
def test_estrutura_invalida_da_erro(tmp_path, conteudo):
    with pytest.raises(ValueError, match="cameras.json"):
        load_cameras(_escreve(tmp_path, conteudo))


def test_lista_vazia_e_permitida(tmp_path):
    assert load_cameras(_escreve(tmp_path, {"cameras": []})) == {}


def test_campo_obrigatorio_que_nao_e_string_levanta_valueerror(tmp_path):
    p = tmp_path / "cameras.json"
    p.write_text(json.dumps({"cameras": [{"sn": "A", "authcode": 5,
                                          "local_user": "u", "local_pwd": "p"}]}))
    with pytest.raises(ValueError, match="authcode"):
        load_cameras(str(p))


@pytest.mark.parametrize("campo", ["sn", "authcode", "local_user", "local_pwd"])
def test_campo_obrigatorio_so_com_espacos_levanta_valueerror(tmp_path, campo):
    cam = {"sn": "A", "authcode": "x", "local_user": "u", "local_pwd": "p"}
    cam[campo] = "   "
    with pytest.raises(ValueError, match="cameras.json|sem os campos"):
        load_cameras(_escreve(tmp_path, {"cameras": [cam]}))


def test_sn_e_guardado_sem_espacos(tmp_path):
    cam = {"sn": "  S1 ", "authcode": "x", "local_user": "u", "local_pwd": "p"}
    cams = load_cameras(_escreve(tmp_path, {"cameras": [cam]}))
    assert list(cams) == ["S1"] and cams["S1"].sn == "S1"

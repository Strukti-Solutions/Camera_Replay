from replay_worker.h264 import is_keyframe, iter_nals, split_access_units
from tests.helpers import nal


def test_iter_nals_informa_offset_e_tipo():
    data = nal(7) + nal(8) + nal(5)
    nals = list(iter_nals(data))
    assert [t for _, t in nals] == [7, 8, 5]
    assert nals[0][0] == 0


def test_iter_nals_aceita_start_code_de_3_bytes():
    data = b"\x00\x00\x01" + bytes([1]) + b"\x11"
    assert list(iter_nals(data)) == [(0, 1)]


def test_iter_nals_ignora_lixo_e_bit_proibido():
    assert list(iter_nals(b"\x01\x02\x03")) == []
    assert list(iter_nals(b"\x00\x00\x01\xff\x11")) == []
    assert list(iter_nals(b"\x00\x00\x01")) == []


def test_split_agrupa_parametros_com_o_idr():
    data = nal(7) + nal(8) + nal(5) + nal(1) + nal(1)
    assert split_access_units(data) == [nal(7) + nal(8) + nal(5), nal(1), nal(1)]


def test_split_dois_gops():
    data = nal(7) + nal(5) + nal(1) + nal(7) + nal(5)
    assert split_access_units(data) == [nal(7) + nal(5), nal(1), nal(7) + nal(5)]


def test_split_descarta_lixo_antes_do_primeiro_nal():
    assert split_access_units(b"\xde\xad\xbe\xef" + nal(1)) == [nal(1)]


def test_split_vazio_e_lixo_nao_lancam():
    assert split_access_units(b"") == []
    assert split_access_units(b"\x01\x02\x03\x04") == []


def test_is_keyframe():
    assert is_keyframe(nal(7) + nal(5))
    assert not is_keyframe(nal(1))
    assert not is_keyframe(b"")

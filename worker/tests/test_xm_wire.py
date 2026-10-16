from replay_worker.xm.wire import (NetIPReader, dewrap, find_last_marker, netip,
                                   video_chunks)
from tests.helpers import nal


def xmf(tipo, h264):
    """Quadro XM sintético: marcador 00 00 01 <tipo> + 4 bytes de cabeçalho + H.264."""
    return b"\x00\x00\x01" + bytes([tipo]) + b"\x01\x02\x03\x04" + h264


class FakeSock:
    def __init__(self, chunks):
        self.chunks = list(chunks)

    def recv(self, n):
        return self.chunks.pop(0) if self.chunks else b""


class FakeReader:
    def __init__(self, msgs):
        self.msgs = list(msgs)

    def read(self):
        return self.msgs.pop(0) if self.msgs else None


def test_dewrap_extrai_video_e_pula_audio():
    media = xmf(0xFC, nal(7) + nal(5)) + xmf(0xFA, b"\x99\x98") + xmf(0xFD, nal(1))
    assert dewrap(media) == nal(7) + nal(5) + nal(1)


def test_dewrap_lixo_nao_lanca():
    assert dewrap(b"") == b""
    assert dewrap(b"\x01\x02\x03\x04\x05") == b""


def test_find_last_marker():
    f1 = xmf(0xFC, nal(7) + nal(5))
    assert find_last_marker(f1 + xmf(0xFD, nal(1))) == len(f1)
    assert find_last_marker(b"sem marcador") == -1


def test_netip_atravessa_recv_fragmentado():
    pkt = netip('{"a":1}', sid=5, msgid=1412)
    r = NetIPReader(FakeSock([pkt[:7], pkt[7:25], pkt[25:]]))
    assert r.read() == (1412, b'{"a":1}\x00')
    assert r.read() is None


def test_video_chunks_segura_o_ultimo_quadro_ate_o_proximo_marcador():
    f1 = xmf(0xFC, nal(7) + nal(5))
    f2 = xmf(0xFD, nal(1))
    f3 = xmf(0xFD, nal(1))
    reader = FakeReader([
        (1412, f1[:10]),
        (1412, f1[10:] + f2),
        (1000, b"{}"),            # mensagem de controle: ignorada
        (1412, f3),
    ])
    assert list(video_chunks(reader)) == [nal(7) + nal(5), nal(1)]


def test_netip_cabecalho_com_comprimento_absurdo_ressincroniza():
    ruim = bytearray(netip('{"x":1}', msgid=1412))
    ruim[16:20] = (0x7FFFFFFF).to_bytes(4, "little")
    bom = netip('{"a":1}', msgid=1412)
    r = NetIPReader(FakeSock([bytes(ruim), bom]))
    assert r.read() == (1412, b'{"a":1}\x00')
    assert len(r.buf) < 1024


def test_netip_lixo_com_ff_antes_de_pacote_valido():
    bom = netip('{"a":1}', msgid=1412)
    r = NetIPReader(FakeSock([b"\x00\xff\x05lixo\xff" + bom]))
    assert r.read() == (1412, b'{"a":1}\x00')

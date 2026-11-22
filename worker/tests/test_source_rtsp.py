import io

import pytest

from replay_worker.source import RtspSource, ocultar_senha
from tests.helpers import KEY, P

URL = "rtsp://admin:s3nh4@192.168.0.50:554/onvif1"


class _Pedacos(io.RawIOBase):
    """stdout falso que entrega o fluxo em pedaços pequenos (corta quadros no meio)."""

    def __init__(self, data: bytes, tamanho: int):
        self._data = data
        self._tam = tamanho

    def readable(self):
        return True

    def readinto(self, b):
        n = min(len(b), self._tam, len(self._data))
        b[:n] = self._data[:n]
        self._data = self._data[n:]
        return n


class _Proc:
    def __init__(self, stdout: bytes, stderr: bytes = b"", code: int = 0, pedaco: int = 3):
        self.stdout = io.BufferedReader(_Pedacos(stdout, pedaco))
        self.stderr = io.BytesIO(stderr)
        self.returncode = None
        self._code = code
        self.terminado = False

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        self.returncode = self._code
        return self.returncode

    def terminate(self):
        self.terminado = True
        self.returncode = -15

    def kill(self):
        self.returncode = -9


def _fonte(proc, **kw):
    chamadas = []

    def popen(cmd, **opts):
        chamadas.append(cmd)
        return proc

    src = RtspSource(URL, popen=popen, ffmpeg="ffmpeg", **kw)
    return src, chamadas


def test_remonta_quadros_cortados_entre_leituras():
    src, _ = _fonte(_Proc(KEY + P + P, pedaco=3))
    src.open()
    assert list(src.chunks()) == [KEY, P, P]


def test_comando_copia_o_h264_sem_recodificar_e_usa_tcp():
    src, chamadas = _fonte(_Proc(KEY))
    src.open()
    cmd = chamadas[0]
    assert cmd[0] == "ffmpeg"
    assert cmd[cmd.index("-rtsp_transport") + 1] == "tcp"
    assert cmd[cmd.index("-i") + 1] == URL
    assert cmd[cmd.index("-c:v") + 1] == "copy"
    assert "h264_mp4toannexb" in cmd
    assert cmd[cmd.index("-f") + 1] == "h264"
    assert cmd[-1] == "pipe:1"


def test_recodificar_usa_libx264_com_keyframe_a_cada_2s():
    src, chamadas = _fonte(_Proc(KEY), recodificar=True, fps=10)
    src.open()
    cmd = chamadas[0]
    assert cmd[cmd.index("-c:v") + 1] == "libx264"
    assert cmd[cmd.index("-g") + 1] == "20"
    # zerolatency liga sliced-threads (várias fatias por quadro): o anel conta quadros errado
    assert "sliced-threads=0" in cmd[cmd.index("-x264-params") + 1]
    assert "h264_mp4toannexb" not in cmd
    # -fflags nobuffer faz o decodificador de H.265 perder referências e não sair nada
    assert "nobuffer" not in cmd


def test_ffmpeg_com_erro_vira_excecao_sem_a_senha():
    erro = ("[rtsp @ 0x1] method DESCRIBE failed: 401 Unauthorized\n"
            "%s: Server returned 401 Unauthorized\n" % URL).encode()
    src, _ = _fonte(_Proc(b"", stderr=erro, code=1))
    src.open()
    with pytest.raises(RuntimeError) as exc:
        list(src.chunks())
    assert "401" in str(exc.value)
    assert "s3nh4" not in str(exc.value)


def test_fim_normal_do_fluxo_so_termina():
    src, _ = _fonte(_Proc(KEY + P, code=0))
    src.open()
    assert list(src.chunks()) == [KEY, P]


def test_close_encerra_o_ffmpeg():
    proc = _Proc(KEY)
    src, _ = _fonte(proc)
    src.open()
    src.close()
    assert proc.terminado


def test_sem_ffmpeg_avisa():
    def popen(cmd, **opts):
        raise FileNotFoundError(cmd[0])

    src = RtspSource(URL, popen=popen, ffmpeg="ffmpeg")
    with pytest.raises(RuntimeError, match="ffmpeg não encontrado"):
        src.open()


def test_repr_nao_mostra_a_senha():
    src = RtspSource(URL, popen=lambda *a, **k: None, ffmpeg="ffmpeg")
    assert "s3nh4" not in repr(src)


@pytest.mark.parametrize("texto,esperado", [
    (URL, "rtsp://admin:***@192.168.0.50:554/onvif1"),
    ("rtsp://192.168.0.50/onvif1", "rtsp://192.168.0.50/onvif1"),
    ("erro em rtsp://u:p@h/x e rtsp://a:b@c/y", "erro em rtsp://u:***@h/x e rtsp://a:***@c/y"),
])
def test_ocultar_senha(texto, esperado):
    assert ocultar_senha(texto) == esperado


def test_transporte_udp_para_camera_que_recusa_tcp():
    # Yoosee responde "Nonmatching transport in server reply" ao pedido TCP
    src, chamadas = _fonte(_Proc(KEY), transporte="udp")
    src.open()
    cmd = chamadas[0]
    assert cmd[cmd.index("-rtsp_transport") + 1] == "udp"


def test_transporte_invalido_e_recusado():
    with pytest.raises(ValueError):
        RtspSource(URL, transporte="http2", popen=lambda *a, **k: None, ffmpeg="ffmpeg")


def test_camera_em_h265_no_modo_copia_sugere_recodificar():
    erro = (b"[h264_mp4toannexb @ 0x1] Codec 'hevc' (172) is not supported by the bitstream "
            b"filter 'h264_mp4toannexb'. Supported codecs are: h264 (27)\n"
            b"[vost#0:0/copy @ 0x2] Error initializing bitstream filter: h264_mp4toannexb\n"
            b"Error opening output file pipe:1.\n"
            b"Error opening output files: Invalid argument\n")
    src, _ = _fonte(_Proc(b"", stderr=erro, code=1))
    src.open()
    with pytest.raises(RuntimeError) as exc:
        list(src.chunks())
    assert "H.265" in str(exc.value)
    assert "--recodificar" in str(exc.value)

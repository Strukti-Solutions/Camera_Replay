"""
wire.py — formato de fio do NetIP/XM: cabeçalho, leitor de pacotes e de-wrap.

Portado de camera/src/xmremote.py e camera/src/webcam.py. Um quadro XM chega
quebrado em vários pacotes NetIP; por isso `video_chunks` acumula o bruto e só
de-wrapa até o ÚLTIMO marcador XM (o resto espera o próximo ciclo).
"""
from collections.abc import Iterator

MSG_VIDEO = 1412   # dados de vídeo neste firmware
MAX_PAYLOAD = 4 * 1024 * 1024   # teto do payload NetIP; acima disso o cabeçalho é lixo


def netip(js, sid=0, msgid=0, seq=0, chn=0) -> bytes:
    """Pacote NetIP: cabeçalho de 20 bytes + JSON terminado em NUL."""
    pl = js.encode("utf-8") + b"\x00"
    h = bytearray(20)
    h[0] = 0xFF
    h[1] = 0x01
    h[4:8] = (sid & 0xFFFFFFFF).to_bytes(4, "little")
    h[8:12] = (seq & 0xFFFFFFFF).to_bytes(4, "little")
    h[12] = chn
    h[14:16] = msgid.to_bytes(2, "little")
    h[16:20] = len(pl).to_bytes(4, "little")
    return bytes(h) + pl


class NetIPReader:
    def __init__(self, sock):
        self.sock = sock
        self.buf = bytearray()

    def _fill(self):
        d = self.sock.recv(65536)
        if not d:
            return False
        self.buf += d
        return True

    def read(self):
        """Próximo pacote como (msgid, payload), ou None se a conexão fechou."""
        while True:
            i = self.buf.find(b"\xff")
            if i < 0:
                self.buf.clear()
                if not self._fill():
                    return None
                continue
            if i:
                del self.buf[:i]
            while len(self.buf) < 20:
                if not self._fill():
                    return None
            ln = int.from_bytes(self.buf[16:20], "little")
            if self.buf[1] != 0x01 or ln > MAX_PAYLOAD:
                del self.buf[:1]   # cabeçalho inválido: ressincroniza
                continue
            mid = int.from_bytes(self.buf[14:16], "little")
            while len(self.buf) < 20 + ln:
                if not self._fill():
                    return None
            pl = bytes(self.buf[20:20 + ln])
            del self.buf[:20 + ln]
            return mid, pl

    def wait(self, mids, tries=25):
        """Lê até achar um pacote de `mids`; devolve (msgid, texto JSON) ou (None, None)."""
        for _ in range(tries):
            fr = self.read()
            if fr is None:
                return None, None
            if fr[0] in mids:
                return fr[0], fr[1].split(b"\x00")[0].decode("utf-8", "ignore")
        return None, None


def _is_marker(b, i):
    return (i + 4 <= len(b) and b[i] == 0 and b[i + 1] == 0 and b[i + 2] == 1
            and 0xF8 <= b[i + 3] <= 0xFE)


def find_last_marker(buf) -> int:
    """Offset do último marcador XM (00 00 01 F8..FE) no buffer, ou -1."""
    i = len(buf) - 4
    while i >= 0:
        if _is_marker(buf, i):
            return i
        i -= 1
    return -1


def dewrap(media: bytes) -> bytes:
    """Remove os cabeçalhos XM e devolve só o H.264 Annex-B.

    Vídeo: marcadores FC/FE (I) e FD (P). Áudio (FA/F9/F8) é descartado. Nunca
    lança exceção: bytes sem marcador resultam em vazio.
    """
    n = len(media)
    out = bytearray()
    i = 0

    def next_marker(j):
        while j + 4 <= n:
            if _is_marker(media, j):
                return j
            j += 1
        return n

    while i + 4 <= n:
        if _is_marker(media, i):
            t = media[i + 3]
            end = next_marker(i + 4)
            if t in (0xFC, 0xFD, 0xFE):
                seg = media[i + 4:end]
                k = seg.find(b"\x00\x00\x00\x01")
                if k < 0:
                    k = seg.find(b"\x00\x00\x01")
                if k >= 0:
                    out += seg[k:]
            i = end
        else:
            i += 1
    return bytes(out)


def video_chunks(reader) -> Iterator[bytes]:
    """H.264 Annex-B desembrulhado, a partir de qualquer objeto com `.read()`."""
    raw = bytearray()
    while True:
        fr = reader.read()
        if fr is None:
            return
        mid, payload = fr
        if mid != MSG_VIDEO:
            continue
        raw += payload
        last = find_last_marker(raw)
        if last > 0:
            h = dewrap(bytes(raw[:last]))
            del raw[:last]
            if h:
                yield h

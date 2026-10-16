"""
h264.py — utilidades de H.264 Annex-B (sem dependências).

Premissa (a validar na câmera real, ver smoke.py): cada quadro é uma fatia só
(NAL tipo 1 ou 5), e os conjuntos de parâmetros (SPS=7, PPS=8) vêm colados
antes do IDR do mesmo quadro.
"""
from collections.abc import Iterator

_START3 = b"\x00\x00\x01"


def iter_nals(data: bytes) -> Iterator[tuple[int, int]]:
    """Gera (offset do start code, tipo do NAL) para cada NAL do buffer.

    O offset inclui o zero inicial quando o start code tem 4 bytes. Bytes com o
    bit proibido ligado (>= 0x80 logo após o start code) são lixo e são pulados.
    """
    n = len(data)
    i = 0
    while True:
        p = data.find(_START3, i)
        if p < 0 or p + 3 >= n:
            return
        i = p + 3
        header = data[p + 3]
        if header & 0x80:
            continue
        yield (p - 1 if p > 0 and data[p - 1] == 0 else p), header & 0x1F


def split_access_units(data: bytes) -> list[bytes]:
    """Separa o fluxo em quadros. Descarta bytes antes do primeiro NAL."""
    nals = list(iter_nals(data))
    if not nals:
        return []
    starts = [nals[0][0]]
    has_slice = False
    for off, t in nals:
        if t in (1, 5):
            if has_slice:
                starts.append(off)
            has_slice = True
        elif t in (7, 9):
            if has_slice:
                starts.append(off)
            has_slice = False
    bounds = starts + [len(data)]
    return [data[a:b] for a, b in zip(bounds, bounds[1:])]


def is_keyframe(au: bytes) -> bool:
    """True se o quadro contém um IDR (NAL tipo 5)."""
    return any(t == 5 for _, t in iter_nals(au))

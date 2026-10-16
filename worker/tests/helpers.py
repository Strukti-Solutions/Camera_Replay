"""Construtores de H.264 sintético para os testes."""
SC = b"\x00\x00\x00\x01"


def nal(t, body=b"\x11\x22"):
    """Um NAL Annex-B de tipo `t` (7=SPS, 8=PPS, 5=IDR, 1=P)."""
    return SC + bytes([t]) + body


KEY = nal(7) + nal(8) + nal(5)   # um quadro-chave completo
P = nal(1)                       # um quadro P


def feed(ring, seconds, gop=10, start=0.0):
    """Alimenta o anel com 1 quadro por segundo; keyframe a cada `gop` quadros."""
    for i in range(int(seconds)):
        ring.append(start + i, KEY if i % gop == 0 else P)

"""
Simulação do caminho completo do relay: quadro -> marcador XM (com áudio no meio)
-> pacotes NetIP de tamanho aleatório -> socket que entrega pedaços quebrados ->
NetIPReader -> video_chunks -> captura -> anel -> MP4.
"""
from __future__ import annotations

import pytest

from replay_worker.xm.wire import MAX_RAW, NetIPReader, StreamDesyncError, video_chunks

from .camera_sim import CameraXmSimulada, SocketFalso, analisar_mp4, pacote_netip, MSG_VIDEO
from .conftest import Bancada


def fatia_contigua(md5_clip: list[str], md5_fonte: list[str]) -> int:
    """Posição em que o clipe aparece inteiro e em ordem dentro da fonte (-1 se não)."""
    n = len(md5_clip)
    for i in range(len(md5_fonte) - n + 1):
        if md5_fonte[i:i + n] == md5_clip:
            return i
    return -1


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_video_pelo_fio_xm_vira_o_clipe_certo(video, bancada: Bancada, seed):
    cam = CameraXmSimulada(video, bancada.relogio, [[("video", 50), ("aperto", "fio")]], seed=seed)
    bancada.rodar(cam)
    r = bancada.resultados["fio"]
    assert r.ok, r.falha
    a = analisar_mp4(r.mp4)
    assert a.erros_decodificacao == ""
    pos = fatia_contigua(a.md5, video.md5)
    assert pos >= 0, "quadros do clipe fora de ordem ou corrompidos pelo fio"
    assert pos in video.keys, "o clipe tem que começar num keyframe"
    assert 30.0 <= a.duracao <= 34.2
    # o último quadro do clipe é, no máximo, 1 quadro antes do último que a câmera mandou
    ultimo_mandado = max(e.idx for e in cam.emitidos if e.t <= r.pressed_at)
    assert ultimo_mandado - (pos + a.quadros - 1) <= 1


def test_fio_com_queda_no_meio_reconecta_e_corta(video, bancada: Bancada):
    cam = CameraXmSimulada(video, bancada.relogio, [
        [("video", 15), ("cai",)],
        [("mudo", 1), ("video", 40), ("aperto", "fio-queda")],
    ])
    bancada.rodar(cam)
    r = bancada.resultados["fio-queda"]
    assert r.ok
    a = analisar_mp4(r.mp4)
    assert a.erros_decodificacao == ""
    assert fatia_contigua(a.md5, video.md5) >= 0


def test_fluxo_sem_marcador_xm_derruba_a_sessao():
    """Bytes de vídeo sem marcador XM por mais de MAX_RAW: sessão cai (e a captura reconecta)."""
    def lixo():
        pedaco = bytes(range(0x10, 0xF0)) * 4096   # ~900 KB sem 00 00 01
        enviado = 0
        while enviado <= MAX_RAW + len(pedaco):
            yield pacote_netip(MSG_VIDEO, pedaco)
            enviado += len(pedaco)

    import random
    leitor = NetIPReader(SocketFalso(lixo(), random.Random(0)))
    with pytest.raises(StreamDesyncError):
        list(video_chunks(leitor))


def test_cabecalho_netip_invalido_ressincroniza(video):
    """Bytes soltos entre pacotes (0xFF falso, cabeçalho truncado) não perdem o vídeo."""
    import random
    from replay_worker.h264 import is_keyframe
    from .camera_sim import _cabecalho_xm
    rnd = random.Random(5)
    aus = video.aus[:80]
    fio = b""
    for au in aus:
        fio += _cabecalho_xm(au, is_keyframe(au), rnd, 10) + au
    fio += b"\x00\x00\x01\xfd\x00\x00\x00\x00"

    def pacotes():
        for i in range(0, len(fio), 900):
            yield b"\xff\x02lixo" + pacote_netip(MSG_VIDEO, fio[i:i + 900])

    leitor = NetIPReader(SocketFalso(pacotes(), rnd))
    recebido = b"".join(video_chunks(leitor))
    assert recebido == b"".join(aus)

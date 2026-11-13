"""
Bateria de simulação do corte de cenas: câmera simulada com vídeo H.264 real,
captura, anel, corte, MP4 (ffmpeg) e capa — tudo no relógio virtual.

A prova principal é por conteúdo: o md5 de cada quadro decodificado do MP4 tem
que ser exatamente o dos quadros que a câmera mandou nos ~30 s antes do aperto.
"""
from __future__ import annotations

import os

import pytest

from replay_worker.ring import Ring

from .camera_sim import CameraSimulada, analisar_mp4, dimensoes_jpeg, tipos_nal
from .conftest import Bancada


def conferir_clipe(cam: CameraSimulada, r, segundos: float = 30.0):
    """Clipe pronto, decodificável, com a janela exata de quadros e capa válida."""
    assert r.ok, "clipe falhou: %s" % r.falha
    clip_id, key, size, duracao, parcial = r.pronto
    assert key == "clipes/%s/%s.mp4" % (r.job.arena_id, r.job.clip_id)
    assert os.path.getsize(r.mp4) == size

    esperados, parcial_esperado = cam.janela_esperada(r.pressed_at, segundos)
    a = analisar_mp4(r.mp4)
    assert a.codec == "h264"
    assert a.erros_decodificacao == "", a.erros_decodificacao
    assert a.quadros == len(esperados)
    assert a.md5 == cam.md5_esperado(esperados), "o clipe não é a cena dos últimos 30 s"
    assert parcial == parcial_esperado
    # velocidade natural: a duração do MP4 é a duração real do trecho
    assert a.duracao == pytest.approx(len(esperados) / cam.fps, abs=0.25)

    with open(r.capa, "rb") as f:
        assert f.read(2) == b"\xff\xd8", "capa não é JPEG"
    assert dimensoes_jpeg(r.capa)[0] == 640
    return a, duracao, parcial


# ------------------------------------------------------------- o vídeo da simulação

def test_video_simulado_tem_o_formato_da_camera_real(video):
    """Premissas de h264.py que a câmera real cumpre: a simulação precisa cumprir também."""
    assert len(video.aus) == 150 * 10
    assert video.keys == list(range(0, 1500, 40))           # keyframe a cada 4 s
    for i in video.keys:
        assert tipos_nal(video.aus[i])[:2] == [7, 8], "SPS/PPS antes de cada IDR"
    fatias = [sum(t in (1, 5) for t in tipos_nal(au)) for au in video.aus]
    assert set(fatias) == {1}, "1 fatia por quadro"
    assert len(video.md5) == len(video.aus)


# ------------------------------------------------------------- caminho feliz

def test_aperto_corta_exatamente_os_30s_anteriores(video, bancada: Bancada):
    cam = CameraSimulada(video, bancada.relogio, [[("video", 60), ("aperto", "lance-1")]])
    bancada.rodar(cam)
    a, duracao, parcial = conferir_clipe(cam, bancada.resultados["lance-1"])
    assert not parcial
    assert 30.0 <= duracao <= 34.1          # começa no keyframe <= aperto - 30 (GOP de 4 s)
    assert a.largura == 320 and a.altura == 180


def test_aperto_no_meio_da_partida_nao_pega_quadro_depois_do_aperto(video, bancada: Bancada):
    cam = CameraSimulada(video, bancada.relogio,
                         [[("video", 47.3), ("aperto", "meio"), ("video", 30)]])
    bancada.rodar(cam)
    r = bancada.resultados["meio"]
    conferir_clipe(cam, r)
    ultimo = max(e.t for e in cam.emitidos if e.t <= r.pressed_at)
    assert ultimo == pytest.approx(r.pressed_at)


def test_aperto_registrado_antes_de_o_worker_pegar(video, bancada: Bancada):
    """O worker pega o pedido 4 s depois: o clipe termina no aperto, não na hora do corte."""
    cam = CameraSimulada(video, bancada.relogio,
                         [[("video", 50), ("video", 4), ("aperto", "atrasado", 4.0), ("video", 10)]])
    bancada.rodar(cam)
    r = bancada.resultados["atrasado"]
    conferir_clipe(cam, r)


def test_varios_apertos_seguidos_geram_clipes_independentes(video, bancada: Bancada):
    cam = CameraSimulada(video, bancada.relogio, [[
        ("video", 40), ("aperto", "a"), ("video", 1.5), ("aperto", "b"),
        ("video", 0.3), ("aperto", "c"), ("video", 20), ("aperto", "d")]])
    bancada.rodar(cam)
    for nome in "abcd":
        conferir_clipe(cam, bancada.resultados[nome])
    assert len({bancada.resultados[n].mp4 for n in "abcd"}) == 4


def test_fps_da_camera_e_medido_e_o_video_sai_em_velocidade_natural(video_15fps, bancada: Bancada):
    cam = CameraSimulada(video_15fps, bancada.relogio, [[("video", 45), ("aperto", "15fps")]])
    bancada.rodar(cam)
    a, duracao, _ = conferir_clipe(cam, bancada.resultados["15fps"])
    assert a.fps == pytest.approx(15, abs=0.1)
    assert 30.0 <= a.duracao <= 32.1


def test_pedacos_com_varios_quadros_ainda_cortam_certo(video, bancada: Bancada):
    """O relay costuma entregar vários quadros por pedaço (mesmo instante de chegada)."""
    cam = CameraSimulada(video, bancada.relogio, [[("video", 55), ("aperto", "lote")]],
                         quadros_por_pedaco=5)
    bancada.rodar(cam)
    conferir_clipe(cam, bancada.resultados["lote"])


# ------------------------------------------------------------- câmera instável

def test_logo_depois_de_ligar_o_clipe_sai_parcial(video, bancada: Bancada):
    cam = CameraSimulada(video, bancada.relogio, [[("video", 12), ("aperto", "cedo")]])
    bancada.rodar(cam)
    a, duracao, parcial = conferir_clipe(cam, bancada.resultados["cedo"])
    assert parcial
    assert duracao < 12.1


def test_queda_e_reconexao_lenta_marcam_buraco(video, bancada: Bancada):
    """Caiu, levou 5 s para reconectar: o clipe sai, mas parcial (tem buraco)."""
    cam = CameraSimulada(video, bancada.relogio, [
        [("video", 20), ("cai",)],
        [("mudo", 5), ("video", 20), ("aperto", "pos-queda")],
    ])
    cap = bancada.rodar(cam)
    assert cam.aberturas >= 2 and cam.fechamentos == cam.aberturas
    assert "ConnectionResetError" in (cap.last_error or "")
    r = bancada.resultados["pos-queda"]
    assert r.ok
    *_, parcial = r.pronto
    assert parcial, "buraco de 6 s dentro do clipe tem que virar 'parcial'"
    a = analisar_mp4(r.mp4)
    assert a.erros_decodificacao == ""       # o relay retoma num keyframe: decodifica limpo


def test_reconexao_rapida_nao_marca_buraco_e_decodifica(video, bancada: Bancada):
    cam = CameraSimulada(video, bancada.relogio, [
        [("video", 20), ("cai",)],
        [("video", 20), ("aperto", "rapida")],
    ])
    bancada.rodar(cam)
    r = bancada.resultados["rapida"]
    assert r.ok
    *_, parcial = r.pronto
    a = analisar_mp4(r.mp4)
    assert not parcial                       # 1 s de backoff < max_gap de 3 s
    assert a.erros_decodificacao == ""
    assert a.md5 == cam.md5_esperado(cam.janela_esperada(r.pressed_at)[0])


def test_backoff_cresce_sem_video_e_zera_quando_volta(video, bancada: Bancada):
    cam = CameraSimulada(video, bancada.relogio, [
        [("recusa",)], [("recusa",)], [("recusa",)], [("recusa",)],
        [("video", 5)],
        [("recusa",)],
    ])
    cap = bancada.rodar(cam)
    assert bancada.esperas == [1, 2, 4, 8, 1, 1]
    assert "ConnectionRefusedError" in cap.last_error


def test_camera_que_nunca_conectou_falha_sem_video(video, bancada: Bancada):
    cam = CameraSimulada(video, bancada.relogio, [[("recusa",)]] * 3)
    cap = bancada.rodar(cam)
    assert cap.status == "offline"
    r = bancada.apertar("sem-camera", bancada.relogio())
    assert not r.ok
    assert r.falha == "sem vídeo no buffer no momento do aperto"


def test_camera_calada_no_aperto_falha_como_offline(video, bancada: Bancada):
    cam = CameraSimulada(video, bancada.relogio,
                         [[("video", 40), ("mudo", 45), ("aperto", "calada")]])
    bancada.rodar(cam)
    r = bancada.resultados["calada"]
    assert bancada.status_no_aperto["calada"] == "offline"
    assert not r.ok
    assert r.falha == "câmera offline no momento do aperto"


def test_status_da_camera_online_e_offline(video, bancada: Bancada):
    vistos = {}
    cam = CameraSimulada(video, bancada.relogio, [[
        ("video", 10), ("aperto", "on"), ("mudo", 29), ("aperto", "ainda-on"),
        ("mudo", 2), ("aperto", "off"), ("video", 1), ("aperto", "volta")]])
    cam.ao_apertar = lambda nome, _t: vistos.__setitem__(nome, cap.status)
    from replay_worker.capture import CameraCapture
    import threading
    cap = CameraCapture("cam-1", lambda: cam, bancada.ring, clock=bancada.relogio)
    stop = threading.Event()
    cap.run_forever(stop, wait=lambda s: stop.set())
    assert vistos == {"on": "online", "ainda-on": "online", "off": "offline", "volta": "online"}


def test_lixo_no_fluxo_nao_estraga_o_clipe(video, bancada: Bancada):
    passos = []
    for _ in range(10):
        passos += [("video", 4.3), ("lixo", 700)]
    cam = CameraSimulada(video, bancada.relogio, [passos + [("aperto", "sujo")]])
    bancada.rodar(cam)
    conferir_clipe(cam, bancada.resultados["sujo"])


def test_pedido_antigo_demais_falha(video, bancada: Bancada):
    bancada.processar_com_atraso = 125.0
    cam = CameraSimulada(video, bancada.relogio, [[("video", 40), ("aperto", "velho")]])
    bancada.rodar(cam)
    assert bancada.resultados["velho"].falha == "pedido antigo demais"


@pytest.mark.xfail(strict=True, reason="dívida conhecida (divida-worker.md, ring.py): o aparo por "
                   "bytes pode descartar o único keyframe e o anel fica só com quadros P -> "
                   "'sem vídeo no buffer'. Inofensivo hoje: teto de 64 MB vs ~0,7 MB em 40 s na câmera real.")
def test_anel_respeita_o_teto_de_memoria(video, tmp_path):
    """Com o teto em 150 KB (menos de 1 GOP) o anel ainda devia cortar a partir de um keyframe."""
    from .camera_sim import Relogio
    b = Bancada(relogio=Relogio(), ring=Ring(max_bytes=150_000), pasta=str(tmp_path / "r2"))
    cam = CameraSimulada(video, b.relogio, [[("video", 60), ("aperto", "teto")]])
    b.rodar(cam)
    maior_quadro = max(len(au) for au in video.aus)
    assert b.ring.size_bytes <= 150_000 + maior_quadro
    r = b.resultados["teto"]
    assert r.ok
    *_, parcial = r.pronto
    assert parcial
    assert analisar_mp4(r.mp4).erros_decodificacao == ""


def test_anel_guarda_so_40s(video, bancada: Bancada):
    cam = CameraSimulada(video, bancada.relogio, [[("video", 120)]])
    bancada.rodar(cam)
    s = bancada.ring.stats()
    assert s.span <= 40.0
    assert s.fps == pytest.approx(10, abs=0.1)


# ------------------------------------------------------------- limites conhecidos

def test_perda_curta_de_quadros_no_meio_do_gop(video, bancada: Bancada):
    """Perda de 1,5 s no meio do GOP (rede ruim, sem cair a conexão).

    Documenta o comportamento atual: o buraco é menor que max_gap (3 s), então o
    clipe sai como completo. O ffmpeg ainda decodifica (o H.264 não acusa a
    referência perdida), mas a imagem fica borrada até o próximo keyframe.
    """
    cam = CameraSimulada(video, bancada.relogio,
                         [[("video", 41.2), ("perde", 1.5), ("video", 20), ("aperto", "perda")]])
    bancada.rodar(cam)
    r = bancada.resultados["perda"]
    assert r.ok
    *_, parcial = r.pronto
    assert not parcial, "hoje uma perda < 3 s não marca o clipe como parcial"

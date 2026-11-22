import json
import threading
import urllib.error
import urllib.request

import pytest

from replay_worker.bancada import Bancada, servir
from replay_worker.ring import Ring


class _Cap:
    status = "online"
    last_error = None


def _sincrono(alvo, *args):
    alvo(*args)


def _bancada(tmp_path, processar, relogio=lambda: 1000.0):
    pausas = []
    b = Bancada(Ring(), _Cap(), str(tmp_path), atraso=1.5, clock=relogio,
                sleep=pausas.append, processar=processar, iniciar=_sincrono)
    return b, pausas


def test_aperto_corta_no_instante_do_aperto_e_fica_pronto(tmp_path):
    vistos = []

    def processar(job, ring, queue, uploader, fps=None):
        vistos.append((job.arena_id, job.pressed_at, fps))
        queue.mark_ready(job.clip_id, "clipes/bancada/%s.mp4" % job.clip_id, 123, 30.4, False)
        return True

    b, pausas = _bancada(tmp_path, processar)
    clip_id = b.apertar()
    assert pausas == [1.5]                      # espera o vídeo do aperto chegar
    assert vistos == [("bancada", 1000.0, None)]
    [c] = b.clipes()
    assert c["id"] == clip_id
    assert c["estado"] == "pronto"
    assert c["duracao"] == 30.4
    assert c["video"] == "/arquivo/%s.mp4" % clip_id


def test_falha_mostra_o_motivo(tmp_path):
    def processar(job, ring, queue, uploader, fps=None):
        queue.mark_failed(job.clip_id, "sem vídeo no buffer no momento do aperto")
        return False

    b, _ = _bancada(tmp_path, processar)
    b.apertar()
    [c] = b.clipes()
    assert c["estado"] == "falhou"
    assert "sem vídeo" in c["motivo"]


def test_clipes_mais_novos_primeiro(tmp_path):
    t = iter([1.0, 2.0])

    def processar(job, ring, queue, uploader, fps=None):
        queue.mark_ready(job.clip_id, "k", 1, 30.0, False)
        return True

    b, _ = _bancada(tmp_path, processar, relogio=lambda: next(t))
    a = b.apertar()
    z = b.apertar()
    assert [c["id"] for c in b.clipes()] == [z, a]


@pytest.fixture
def servidor(tmp_path):
    def processar(job, ring, queue, uploader, fps=None):
        uploader.put("clipes/bancada/%s.mp4" % job.clip_id, b"MP4")
        queue.mark_ready(job.clip_id, "k", 3, 30.0, False)
        return True

    b, _ = _bancada(tmp_path, processar)
    srv = servir(b, porta=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d" % srv.server_address[1]
    srv.shutdown()


def _req(url, metodo="GET", cabecalhos=None):
    r = urllib.request.Request(url, method=metodo, headers=cabecalhos or {})
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_pagina_tem_o_botao(servidor):
    status, corpo = _req(servidor + "/")
    assert status == 200
    assert b"id=\"botao\"" in corpo


def test_aperto_sem_cabecalho_da_pagina_e_recusado(servidor):
    status, _ = _req(servidor + "/aperto", "POST")
    assert status == 403


def test_aperto_pela_pagina_gera_clipe_servido(servidor):
    status, corpo = _req(servidor + "/aperto", "POST", {"X-Bancada": "1"})
    assert status == 202
    clip_id = json.loads(corpo)["id"]
    status, corpo = _req(servidor + "/clipes")
    assert json.loads(corpo)["clipes"][0]["estado"] == "pronto"
    status, corpo = _req(servidor + "/arquivo/%s.mp4" % clip_id)
    assert (status, corpo) == (200, b"MP4")


@pytest.mark.parametrize("caminho", ["/arquivo/../x.mp4", "/arquivo/abc.exe", "/arquivo/%2e%2e.mp4"])
def test_arquivo_so_aceita_id_valido(servidor, caminho):
    status, _ = _req(servidor + caminho)
    assert status == 404


def test_status_em_json(servidor):
    status, corpo = _req(servidor + "/status")
    dados = json.loads(corpo)
    assert status == 200
    assert dados["status"] == "online"
    assert "fps" in dados


def test_cli_aceita_udp():
    from replay_worker.bancada import argumentos
    assert argumentos(["--udp"]).udp is True
    assert argumentos([]).udp is False

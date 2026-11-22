import io
import json
import threading
import urllib.error
import urllib.request

import pytest

from replay_worker.botao_virtual import BotaoReal, servir

TOKEN = "t" * 43


class _Resp(io.BytesIO):
    def __init__(self, status, corpo):
        super().__init__(json.dumps(corpo).encode())
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_aperto_chama_a_api_com_o_token_no_cabecalho():
    pedidos = []

    def abrir(req, timeout):
        pedidos.append(req)
        return _Resp(202, {"clipe_id": "c1", "duplicado": False})

    b = BotaoReal("https://camera-replay.vercel.app", TOKEN, abrir=abrir, clock=lambda: 5.0)
    r = b.apertar()
    [req] = pedidos
    assert req.full_url == "https://camera-replay.vercel.app/api/botao/aperto"
    assert req.get_method() == "POST"
    assert req.get_header("Authorization") == "Bearer " + TOKEN
    assert r == {"ok": True, "status": 202, "clipe_id": "c1", "duplicado": False, "em": 5.0}
    assert b.apertos() == [r]


def test_token_recusado_vira_erro_sem_mostrar_o_token():
    def abrir(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 401, "x", {}, io.BytesIO(b'{"erro":"token inv\u00e1lido"}'))

    b = BotaoReal("https://x.app", TOKEN, abrir=abrir)
    r = b.apertar()
    assert r["ok"] is False and r["status"] == 401
    assert "token inválido" in r["erro"]
    assert TOKEN not in json.dumps(b.apertos())


def test_rede_fora_do_ar_vira_erro():
    def abrir(req, timeout):
        raise urllib.error.URLError("sem rede")

    r = BotaoReal("https://x.app", TOKEN, abrir=abrir).apertar()
    assert r["ok"] is False and r["status"] is None


def test_url_sem_https_e_recusada():
    with pytest.raises(ValueError):
        BotaoReal("http://x.app", TOKEN)


@pytest.fixture
def servidor():
    def abrir(req, timeout):
        return _Resp(202, {"clipe_id": "c9", "duplicado": False})

    srv = servir(BotaoReal("https://x.app", TOKEN, abrir=abrir), porta=0,
                 pagina_arena="https://x.app/a/arena-teste")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d" % srv.server_address[1]
    srv.shutdown()


def _req(url, metodo="GET", cab=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method=metodo, headers=cab or {}),
                                    timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_pagina_tem_o_botao_e_o_link_da_arena_sem_o_token(servidor):
    status, corpo = _req(servidor + "/")
    assert status == 200
    assert b'id="botao"' in corpo
    assert b"https://x.app/a/arena-teste" in corpo
    assert TOKEN.encode() not in corpo


def test_aperto_exige_o_cabecalho_da_pagina(servidor):
    assert _req(servidor + "/aperto", "POST")[0] == 403
    status, corpo = _req(servidor + "/aperto", "POST", {"X-Bancada": "1"})
    assert status == 200
    assert json.loads(corpo)["clipe_id"] == "c9"
    assert json.loads(_req(servidor + "/apertos")[1])["apertos"][0]["clipe_id"] == "c9"

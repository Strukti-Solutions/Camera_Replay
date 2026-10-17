"""Testes da fila do Postgres, com conexão falsa que grava SQL e parâmetros."""
from __future__ import annotations

import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import psycopg
import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from replay_worker.pg import Camera, ClockSync, PgJobQueue

CHAVE = bytes(range(32))


def _cifrar(authcode="AUTH", user="admin", pwd="SENHA-SECRETA") -> str:
    iv = os.urandom(12)
    bruto = AESGCM(CHAVE).encrypt(
        iv, json.dumps({"authcode": authcode, "local_user": user, "local_pwd": pwd}).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return f"v1:{b(iv)}:{b(bruto[-16:])}:{b(bruto[:-16])}"


class Cursor:
    def __init__(self, linhas):
        self._linhas = linhas

    def fetchall(self):
        return list(self._linhas)

    def fetchone(self):
        return self._linhas[0] if self._linhas else None


class Conn:
    def __init__(self, respostas=None, erro=None):
        self.chamadas = []
        self.respostas = respostas or []
        self.erro = erro
        self.fechada = False

    def execute(self, sql, params=()):
        self.chamadas.append((sql, params))
        if self.erro:
            raise self.erro
        return Cursor(self.respostas.pop(0) if self.respostas else [])

    def close(self):
        self.fechada = True


class RelogioFalso:
    """Devolve tempos pré-definidos a cada chamada."""

    def __init__(self, tempos):
        self.tempos = list(tempos)

    def __call__(self):
        return self.tempos.pop(0)


def _sync_nulo():
    s = ClockSync(lambda: 0.0)
    return s


def test_clocksync_escolhe_menor_ida_e_volta():
    # banco 7 s à frente; amostras com rtt 0,6, 0,2 e 0,4
    clock = RelogioFalso([100.0, 100.6, 200.0, 200.2, 300.0, 300.4])
    epochs = iter([100.3 + 7, 200.1 + 7, 300.2 + 7])
    s = ClockSync(lambda: next(epochs), clock=clock)
    s.sync()
    assert s.to_local(1007.0) == pytest.approx(1000.0, abs=0.11)


def test_clocksync_prefere_amostra_de_menor_rtt():
    # a primeira amostra tem rtt enorme e erro grande; a segunda é a boa
    clock = RelogioFalso([0.0, 4.0, 10.0, 10.2, 20.0, 21.0])
    epochs = iter([2.0 + 7 + 1.5, 10.1 + 7, 20.5 + 7 + 0.4])
    s = ClockSync(lambda: next(epochs), clock=clock)
    s.sync()
    assert s.to_local(50.0) == pytest.approx(43.0, abs=0.001)


def _job_conn(rec):
    return Conn(respostas=[[(uuid.UUID(int=1), uuid.UUID(int=2), uuid.UUID(int=3), rec)]])


def test_claim_pending_converte_relogio_e_ids():
    rec = datetime.fromtimestamp(1007.0, tz=timezone.utc)
    conn = _job_conn(rec)
    s = ClockSync(lambda: 0.0)
    s.offset = 7.0
    q = PgJobQueue(lambda: conn, s, CHAVE)
    jobs = q.claim_pending("cam-1")
    assert conn.chamadas == [("select * from pegar_clipes(%s, %s)", ("cam-1", 5))]
    assert len(jobs) == 1
    j = jobs[0]
    assert j.clip_id == str(uuid.UUID(int=1))
    assert j.camera_id == str(uuid.UUID(int=2))
    assert j.arena_id == str(uuid.UUID(int=3))
    assert j.pressed_at == pytest.approx(1000.0)


def test_mark_ready_e_mark_failed():
    conn = Conn(respostas=[[(True,)], [(True,)]])
    q = PgJobQueue(lambda: conn, _sync_nulo(), CHAVE)
    assert q.mark_ready("c1", "clipes/a/c1.mp4", 123, 29.5, False) is True
    assert q.mark_failed("c1", "motivo") is None
    assert "marcar_pronto" in conn.chamadas[0][0]
    assert conn.chamadas[0][1] == ("c1", "clipes/a/c1.mp4", 123, 29.5, False)
    assert "marcar_falhou" in conn.chamadas[1][0]
    assert conn.chamadas[1][1] == ("c1", "motivo")


def test_erro_de_conexao_descarta_e_reconecta():
    conexoes = []

    def connect():
        c = Conn(erro=psycopg.OperationalError("host=segredo"))
        conexoes.append(c)
        return c

    q = PgJobQueue(connect, _sync_nulo(), CHAVE)
    with pytest.raises(psycopg.OperationalError):
        q.claim_pending("x")
    assert len(conexoes) == 1 and conexoes[0].fechada
    with pytest.raises(psycopg.OperationalError):
        q.claim_pending("x")
    assert len(conexoes) == 2


def test_listar_cameras_pula_credencial_ruim(caplog):
    boa = _cifrar()
    ruim = boa[:-4] + ("AAAA" if not boa.endswith("AAAA") else "BBBB")
    cam_ok, cam_ruim = uuid.UUID(int=10), uuid.UUID(int=11)
    arena = uuid.UUID(int=20)
    conn = Conn(respostas=[[(cam_ok, arena, "SN1", boa), (cam_ruim, arena, "SN2", ruim)]])
    q = PgJobQueue(lambda: conn, _sync_nulo(), CHAVE)
    with caplog.at_level(logging.DEBUG):
        cams = q.listar_cameras()
    assert len(cams) == 1
    assert isinstance(cams[0], Camera) and cams[0].camera_id == str(cam_ok)
    assert cams[0].creds.local_pwd == "SENHA-SECRETA"
    assert f"câmera {cam_ruim}: credencial inválida" in caplog.text
    assert ruim not in caplog.text and "SENHA-SECRETA" not in caplog.text


def test_marcar_camera_e_expirar_presos():
    conn = Conn(respostas=[[(True,)], [(3,)]])
    q = PgJobQueue(lambda: conn, _sync_nulo(), CHAVE)
    assert q.marcar_camera("c", "online") is None
    assert q.expirar_presos() == 3
    assert conn.chamadas[0] == ("select marcar_camera(%s, %s)", ("c", "online"))
    assert conn.chamadas[1][0] == "select expirar_presos()"


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="sem DATABASE_URL")
def test_integracao_pegar_e_marcar_pronto():
    url = os.environ["DATABASE_URL"]
    q = PgJobQueue(lambda: psycopg.connect(url, autocommit=True), ClockSync(lambda: 0.0), CHAVE)
    cams = q.listar_cameras()
    assert isinstance(cams, list)

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
    assert conn.chamadas == [("select * from pegar_clipes(%s::uuid, %s::int)", ("cam-1", 5))]
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
    assert conn.chamadas[0][0] == (
        "select marcar_pronto(%s::uuid, %s::text, %s::bigint, %s::real, %s::boolean)")
    assert conn.chamadas[0][1] == ("c1", "clipes/a/c1.mp4", 123, 29.5, False)
    assert conn.chamadas[1][0] == "select marcar_falhou(%s::uuid, %s::text)"
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
    assert conn.chamadas[0] == ("select marcar_camera(%s::uuid, %s::text)", ("c", "online"))
    assert conn.chamadas[1][0] == "select expirar_presos()"


def test_erro_que_nao_e_de_conexao_nao_descarta_a_conexao():
    conexoes = []

    def connect():
        c = Conn(erro=psycopg.errors.InvalidParameterValue("chave"))
        conexoes.append(c)
        return c

    q = PgJobQueue(connect, _sync_nulo(), CHAVE)
    for _ in range(2):
        with pytest.raises(psycopg.Error):
            q.claim_pending("c")
    assert len(conexoes) == 1 and not conexoes[0].fechada


@pytest.mark.parametrize("erro", [
    psycopg.errors.InvalidParameterValue("chave"),      # 22023, DataError
    psycopg.errors.UniqueViolation("dup"),              # IntegrityError
    psycopg.errors.UndefinedFunction("sem funcao"),     # ProgrammingError
])
def test_mark_ready_recusa_definitiva_do_servidor_vira_false(erro, caplog):
    conexoes = []

    def connect():
        c = Conn(erro=erro)
        conexoes.append(c)
        return c

    q = PgJobQueue(connect, _sync_nulo(), CHAVE)
    with caplog.at_level(logging.DEBUG):
        assert q.mark_ready("c1", "chave-errada", 1, 1.0, False) is False
    assert "clipe c1: marcar_pronto recusado" in caplog.text
    assert str(erro.sqlstate) in caplog.text
    assert "chave" not in caplog.text.replace("marcar_pronto", "")
    assert len(conexoes) == 1 and not conexoes[0].fechada


def test_mark_ready_erro_de_conexao_continua_subindo():
    conn = Conn(erro=psycopg.OperationalError("host=segredo"))
    q = PgJobQueue(lambda: conn, _sync_nulo(), CHAVE)
    with pytest.raises(psycopg.OperationalError):
        q.mark_ready("c1", "k", 1, 1.0, False)
    assert conn.fechada


def test_credencial_invalida_loga_so_na_primeira_vez(caplog):
    boa = _cifrar()
    ruim = boa[:-4] + ("AAAA" if not boa.endswith("AAAA") else "BBBB")
    cam_ruim, arena = uuid.UUID(int=11), uuid.UUID(int=20)
    conn = Conn(respostas=[[(cam_ruim, arena, "SN2", ruim)], [(cam_ruim, arena, "SN2", ruim)]])
    q = PgJobQueue(lambda: conn, _sync_nulo(), CHAVE)
    with caplog.at_level(logging.DEBUG):
        assert q.listar_cameras() == []
        assert q.listar_cameras() == []
    assert caplog.text.count("credencial inválida") == 1


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="sem DATABASE_URL")
def test_integracao_fluxo_da_fila():
    """Contra um Postgres migrado: aperto -> claim_pending -> mark_ready."""
    import hashlib

    url = os.environ["DATABASE_URL"]
    sufixo = uuid.uuid4().hex
    token_hash = hashlib.sha256(f"teste-worker-{sufixo}".encode()).hexdigest()
    ids: dict[str, str] = {}
    fx = psycopg.connect(url, autocommit=True)
    try:
        ids["arena"] = str(fx.execute(
            "insert into arenas (nome) values (%s) returning id",
            (f"teste-worker-{sufixo}",)).fetchone()[0])
        ids["quadra"] = str(fx.execute(
            "insert into quadras (arena_id, nome, slug) values (%s, 'q', %s) returning id",
            (ids["arena"], f"teste-worker-{sufixo}")).fetchone()[0])
        ids["camera"] = str(fx.execute(
            "insert into cameras (arena_id, quadra_id, nome, sn, credenciais)"
            " values (%s, %s, 'c', %s, %s) returning id",
            (ids["arena"], ids["quadra"], f"SN{sufixo[:8]}", _cifrar())).fetchone()[0])
        fx.execute(
            "insert into botoes (arena_id, quadra_id, camera_id, token_hash)"
            " values (%s, %s, %s, %s)",
            (ids["arena"], ids["quadra"], ids["camera"], token_hash))

        q = PgJobQueue(lambda: psycopg.connect(url, autocommit=True),
                       ClockSync(lambda: 0.0), CHAVE)
        clipe = str(fx.execute("select clipe_id from registrar_aperto(%s)",
                               (token_hash,)).fetchone()[0])
        jobs = q.claim_pending(ids["camera"])
        assert [j.clip_id for j in jobs] == [clipe]
        assert jobs[0].arena_id == ids["arena"]

        # chave fora do contrato: 22023, e a conexão segue utilizável
        assert q.mark_ready(clipe, f"clipes/outra/{clipe}.mp4", 10, 1.5, False) is False
        assert q.expirar_presos() >= 0

        chave = f"clipes/{ids['arena']}/{clipe}.mp4"
        assert q.mark_ready(clipe, chave, 10, 1.5, False) is True
    finally:
        try:
            if "arena" in ids:
                a = ids["arena"]
                for tab in ("clipes", "apertos", "botoes", "cameras", "quadras"):
                    fx.execute(f"delete from {tab} where arena_id = %s", (a,))
                fx.execute("delete from arenas where id = %s", (a,))
        finally:
            fx.close()

"""Fila de clipes no Postgres, com relógio do banco e reconexão.

O worker só chama as funções SQL do contrato; nunca toca nas tabelas. Logs
citam apenas ids e o tipo da exceção: nada de DATABASE_URL, credencial ou
mensagem do psycopg (pode trazer dados de conexão).
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Callable

import psycopg

from replay_worker.clipper import ClipJob
from replay_worker.creds import decifrar_credenciais
from replay_worker.xm.relay import CameraCreds

log = logging.getLogger(__name__)

_AMOSTRAS = 3


class ClockSync:
    """Estima o deslocamento entre o relógio do banco e o local."""

    def __init__(self, query_epoch: Callable[[], float], clock: Callable[[], float] = time.time):
        self._query_epoch = query_epoch
        self._clock = clock
        self.offset = 0.0  # banco - local

    def sync(self) -> None:
        """Mede 3 vezes e fica com a amostra de menor ida e volta."""
        melhor: tuple[float, float] | None = None  # (rtt, offset)
        for _ in range(_AMOSTRAS):
            t0 = self._clock()
            db = float(self._query_epoch())
            t1 = self._clock()
            rtt = t1 - t0
            if melhor is None or rtt < melhor[0]:
                melhor = (rtt, db - (t0 + t1) / 2)
        if melhor is not None:
            self.offset = melhor[1]

    def to_local(self, db_epoch: float) -> float:
        """Converte um instante do relógio do banco para o relógio local."""
        return db_epoch - self.offset


@dataclass(frozen=True)
class Camera:
    camera_id: str
    arena_id: str
    sn: str
    creds: CameraCreds

    def __repr__(self) -> str:  # nunca expõe as credenciais
        return f"Camera(camera_id={self.camera_id!r}, arena_id={self.arena_id!r})"


class PgJobQueue:
    """Implementa JobQueue sobre as funções SQL do contrato.

    ``connect()`` deve devolver uma conexão psycopg em autocommit, de modo que
    cada chamada seja a sua transação (um erro 22023 não contamina as demais).
    """

    def __init__(self, connect: Callable[[], Any], clock_sync: ClockSync,
                 chave: bytes, limite: int = 5):
        self._connect = connect
        self._clock_sync = clock_sync
        self._chave = chave
        self._limite = limite
        self._conn: Any = None
        self._cameras_avisadas: set[str] = set()  # credencial inválida: avisa 1 vez por câmera

    def _exec(self, sql: str, params: tuple = ()) -> list:
        """Executa uma consulta; erro de conexão descarta a conexão e sobe."""
        if self._conn is None:
            self._conn = self._connect()
        try:
            return self._conn.execute(sql, params).fetchall()
        except psycopg.OperationalError as e:
            log.warning("banco: conexão perdida (%s)", type(e).__name__)
            conn, self._conn = self._conn, None
            try:
                conn.close()
            except Exception:
                pass
            raise

    def claim_pending(self, camera_id: str) -> list[ClipJob]:
        linhas = self._exec("select * from pegar_clipes(%s::uuid, %s::int)", (camera_id, self._limite))
        return [
            ClipJob(clip_id=str(clipe), camera_id=str(cam), arena_id=str(arena),
                    pressed_at=self._clock_sync.to_local(recebido.timestamp()))
            for clipe, cam, arena, recebido in linhas
        ]

    def mark_ready(self, clip_id: str, key: str, size: int, duration: float,
                   partial: bool) -> bool:
        try:
            linhas = self._exec(
                "select marcar_pronto(%s::uuid, %s::text, %s::bigint, %s::real, %s::boolean)",
                (clip_id, key, size, duration, partial))
        except (psycopg.errors.DataError, psycopg.errors.IntegrityError,
                psycopg.errors.ProgrammingError) as e:
            # recusa definitiva do servidor (ex.: 22023, chave fora do contrato)
            log.warning("clipe %s: marcar_pronto recusado (%s)", clip_id, e.sqlstate)
            return False
        return bool(linhas[0][0]) if linhas else False

    def mark_failed(self, clip_id: str, reason: str) -> None:
        self._exec("select marcar_falhou(%s::uuid, %s::text)", (clip_id, reason))

    def listar_cameras(self) -> list[Camera]:
        cameras: list[Camera] = []
        for cam, arena, sn, texto in self._exec("select * from listar_cameras()"):
            try:
                creds = decifrar_credenciais(texto, self._chave, sn)
            except ValueError:
                if str(cam) not in self._cameras_avisadas:
                    self._cameras_avisadas.add(str(cam))
                    log.warning("câmera %s: credencial inválida", cam)
                continue
            cameras.append(Camera(str(cam), str(arena), sn, creds))
        return cameras

    def marcar_camera(self, camera_id: str, status: str) -> None:
        self._exec("select marcar_camera(%s::uuid, %s::text)", (camera_id, status))

    def expirar_presos(self) -> int:
        linhas = self._exec("select expirar_presos()")
        return int(linhas[0][0]) if linhas else 0

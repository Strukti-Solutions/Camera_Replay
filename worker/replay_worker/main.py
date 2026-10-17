"""Supervisor 24 h: liga a fila do Postgres, o R2 e uma captura por câmera.

Uso: ``py -m replay_worker.main``. Nada aqui imprime valor de variável de
ambiente, DATABASE_URL nem mensagem de exceção do psycopg (pode conter a URL):
os logs citam câmera e clipe pelo id e a exceção só pelo tipo.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time
from dataclasses import dataclass, replace
from typing import Any, Callable

from replay_worker.capture import CameraCapture
from replay_worker.clipper import process_job
from replay_worker.mux import h264_to_mp4
from replay_worker.ring import Ring

log = logging.getLogger(__name__)

_ESPERA_MAX_RELAY = 10.0   # teto da espera pelo atraso do relay, por clipe
_PASSO_ESPERA = 0.5        # fatia máxima de cada espera
_JOIN_TIMEOUT = 5.0

_OBRIGATORIAS = ("DATABASE_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID",
                 "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "CAMERA_CRED_KEY")


@dataclass
class _Ativa:
    camera: Any
    capture: CameraCapture
    stop: threading.Event
    thread: threading.Thread


class Supervisor:
    """Mantém uma captura por câmera do banco e processa os clipes pendentes."""

    def __init__(self, queue, uploader, make_source: Callable[[Any], Any],
                 clock: Callable[[], float] = time.time, relay_lag: float = 0.0,
                 mux=h264_to_mp4, sleep: Callable[[float], Any] | None = None):
        self._queue = queue
        self._uploader = uploader
        self._make_source = make_source
        self._clock = clock
        self._relay_lag = relay_lag
        self._mux = mux
        self._parar = threading.Event()
        self._sleep = sleep or self._parar.wait
        self._ativas: dict[str, _Ativa] = {}

    def _subir(self, camera) -> None:
        ring = Ring()
        # a CameraCapture chama make_source() sem argumentos: fecha sobre a câmera
        cap = CameraCapture(camera.camera_id, lambda c=camera: self._make_source(c),
                            ring, clock=self._clock)
        stop = threading.Event()
        t = threading.Thread(target=cap.run_forever, args=(stop,), daemon=True,
                             name="captura-%s" % camera.camera_id)
        self._ativas[camera.camera_id] = _Ativa(camera, cap, stop, t)
        t.start()

    def _parar_captura(self, camera_id: str) -> None:
        a = self._ativas.pop(camera_id)
        a.stop.set()
        a.thread.join(_JOIN_TIMEOUT)
        try:
            self._queue.marcar_camera(camera_id, "offline")
        except Exception as exc:
            log.warning("câmera %s: falha ao marcar offline (%s)", camera_id, type(exc).__name__)

    def refresh(self) -> None:
        """Sincroniza as capturas com a lista de câmeras do banco."""
        cameras = {c.camera_id: c for c in self._queue.listar_cameras()}
        for camera_id in list(self._ativas):
            # câmera removida ou com credencial trocada: derruba a captura antiga
            if camera_id not in cameras or self._ativas[camera_id].camera != cameras[camera_id]:
                self._parar_captura(camera_id)
        for camera_id, camera in cameras.items():
            if camera_id not in self._ativas:
                self._subir(camera)

    def _esperar_relay(self, pressed_at: float) -> None:
        """Espera o vídeo do relay alcançar o aperto (no máximo 10 s)."""
        alvo = pressed_at + self._relay_lag
        limite = self._clock() + _ESPERA_MAX_RELAY
        while not self._parar.is_set():
            restante = min(alvo, limite) - self._clock()
            if restante <= 0:
                return
            self._sleep(min(restante, _PASSO_ESPERA))

    def poll_once(self) -> int:
        """Processa os clipes pendentes de cada câmera; devolve quantos ficaram prontos."""
        prontos = 0
        for camera_id, a in list(self._ativas.items()):
            try:
                jobs = self._queue.claim_pending(camera_id)
            except Exception as exc:
                log.warning("câmera %s: falha ao pegar clipes (%s)", camera_id, type(exc).__name__)
                continue
            for job in jobs:
                self._esperar_relay(job.pressed_at)
                # o anel guarda a chegada do quadro: o lance chega em aperto + atraso
                job = replace(job, pressed_at=job.pressed_at + self._relay_lag)
                if process_job(job, a.capture.ring, self._queue, self._uploader,
                               fps=None, clock=self._clock, mux=self._mux):
                    prontos += 1
        return prontos

    def report_status(self) -> None:
        for camera_id, a in list(self._ativas.items()):
            try:
                self._queue.marcar_camera(camera_id, a.capture.status)
            except Exception as exc:
                log.warning("câmera %s: falha ao marcar status (%s)", camera_id, type(exc).__name__)

    def stop(self) -> None:
        self._parar.set()
        for camera_id in list(self._ativas):
            self._parar_captura(camera_id)


def _kwargs_conexao() -> dict[str, Any]:
    """Opções do psycopg.connect: timeouts e keepalive evitam travar numa conexão morta."""
    return dict(autocommit=True, connect_timeout=10, keepalives=1, keepalives_idle=30,
                keepalives_interval=10, keepalives_count=3,
                options="-c statement_timeout=15000")


def _ler_float(nome: str, padrao: float) -> float:
    bruto = os.environ.get(nome, "").strip()
    if not bruto:
        return padrao
    try:
        return float(bruto)
    except ValueError:
        raise ValueError("%s inválida" % nome) from None


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    faltando = [n for n in _OBRIGATORIAS if not os.environ.get(n, "").strip()]
    if faltando:
        print("variáveis de ambiente obrigatórias ausentes: " + ", ".join(faltando),
              file=sys.stderr)
        return 2

    # imports pesados só depois de validar o ambiente
    import psycopg

    from replay_worker.creds import ler_chave
    from replay_worker.pg import ClockSync, PgJobQueue
    from replay_worker.r2 import R2Uploader
    from replay_worker.source import RelaySource

    try:
        chave = ler_chave(os.environ["CAMERA_CRED_KEY"])
        lag = _ler_float("RELAY_LAG_S", 0.0)
        poll_s = _ler_float("WORKER_POLL_S", 1.0)
    except ValueError as exc:
        print("configuração inválida: %s" % exc, file=sys.stderr)
        return 2

    url = os.environ["DATABASE_URL"]

    def connect():
        return psycopg.connect(url, **_kwargs_conexao())

    relogio_conn: list[Any] = [None]

    def query_epoch() -> float:
        """Hora do banco em epoch, numa conexão própria que se refaz em caso de erro."""
        try:
            if relogio_conn[0] is None:
                relogio_conn[0] = connect()
            linha = relogio_conn[0].execute("select extract(epoch from clock_timestamp())::float8").fetchone()
            return float(linha[0])
        except Exception:
            c, relogio_conn[0] = relogio_conn[0], None
            try:
                if c is not None:
                    c.close()
            except Exception:
                pass
            raise

    sync = ClockSync(query_epoch)
    queue = PgJobQueue(connect, sync, chave)
    uploader = R2Uploader(os.environ["R2_ACCOUNT_ID"], os.environ["R2_ACCESS_KEY_ID"],
                          os.environ["R2_SECRET_ACCESS_KEY"], os.environ["R2_BUCKET"])
    sup = Supervisor(queue, uploader, lambda camera: RelaySource(camera.creds), relay_lag=lag)

    parar = threading.Event()

    def ao_sinal(signum, frame):
        parar.set()

    signal.signal(signal.SIGINT, ao_sinal)
    signal.signal(signal.SIGTERM, ao_sinal)

    # [nome, período em s, ação, próximo instante]; a primeira rodada é imediata
    tarefas: list[list] = [
        ["sync", 30.0, sync.sync, 0.0],
        ["refresh", 30.0, sup.refresh, 0.0],
        ["status", 15.0, sup.report_status, 0.0],
        ["expirar", 60.0, queue.expirar_presos, 0.0],
        ["poll", poll_s, sup.poll_once, 0.0],
    ]
    log.info("worker iniciado")
    try:
        while not parar.is_set():
            for t in tarefas:
                if time.monotonic() >= t[3]:
                    try:
                        t[2]()
                    except Exception as exc:  # banco fora do ar não derruba o laço
                        log.warning("tarefa %s falhou (%s)", t[0], type(exc).__name__)
                    t[3] = time.monotonic() + t[1]
            parar.wait(min(0.2, poll_s))
    finally:
        sup.stop()
        log.info("worker encerrado")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
camera_sim.py — câmera simulada para a bateria de simulação.

Vídeo H.264 de verdade (gerado pelo ffmpeg, no formato que a câmera real manda:
1 fatia por quadro, SPS/PPS antes de cada IDR, sem B-frames), relógio virtual e
um roteiro de eventos por sessão:

    ("video", s)          envia s segundos de quadros no ritmo do fps
    ("mudo", s)           o tempo passa sem vídeo (conexão aberta, câmera calada)
    ("perde", s)          s segundos de quadros se perdem no caminho (buraco no meio do GOP)
    ("lixo", n)           n bytes sem start code no meio do fluxo
    ("cai",)              a conexão cai (ConnectionResetError)
    ("aperto", nome, r)   o jogador aperta o botão r segundos atrás (chama `ao_apertar`)
    sessão [("recusa",)]  o open() falha (câmera/relay recusou)

Fim dos passos = a câmera fecha a conexão normalmente.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass

from replay_worker.h264 import iter_nals, is_keyframe, split_access_units
from replay_worker.xm.wire import MSG_VIDEO, NetIPReader, video_chunks

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


# ---------------------------------------------------------------- relógios

class Relogio:
    """Relógio virtual: só anda quando alguém chama `avancar`."""

    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t
        self._lock = threading.Lock()

    def __call__(self) -> float:
        return self.t

    def avancar(self, dt: float) -> None:
        with self._lock:
            self.t += dt


class RelogioAcelerado:
    """Relógio real acelerado `escala` vezes: `avancar(dt)` dorme dt/escala de verdade.

    Serve para rodar o Supervisor (threads de verdade) sem esperar 30 s reais.
    """

    def __init__(self, escala: float = 20.0, t0: float = 1_800_000_000.0):
        self.escala = escala
        self._t0 = t0
        self._m0 = time.monotonic()

    def __call__(self) -> float:
        return self._t0 + (time.monotonic() - self._m0) * self.escala

    def avancar(self, dt: float) -> None:
        time.sleep(max(0.0, dt / self.escala))

    def dormir_real(self, dt_virtual: float) -> None:
        self.avancar(dt_virtual)


# ---------------------------------------------------------------- vídeo de teste

@dataclass(frozen=True)
class Video:
    path: str
    fps: int
    gop: int
    aus: list[bytes]
    md5: list[str]        # md5 do quadro decodificado, na ordem do arquivo

    @property
    def keys(self) -> list[int]:
        return [i for i, au in enumerate(self.aus) if is_keyframe(au)]


def gerar_video(destino: str, segundos: int, fps: int = 10, gop: int = 40,
                tamanho: str = "320x180", padrao: str = "testsrc2") -> Video:
    """H.264 Annex-B no formato da câmera real (keyframe a cada gop/fps segundos)."""
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "%s=size=%s:rate=%d" % (padrao, tamanho, fps),
         "-t", str(segundos), "-pix_fmt", "yuv420p",
         "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1",
         "-x264-params", "repeat-headers=1:bframes=0:scenecut=0:keyint=%d:min-keyint=%d" % (gop, gop),
         "-f", "h264", destino],
        check=True, capture_output=True)
    with open(destino, "rb") as f:
        aus = split_access_units(f.read())
    return Video(destino, fps, gop, aus, frame_md5(destino, formato="h264"))


def frame_md5(path: str, formato: str | None = None) -> list[str]:
    """md5 de cada quadro decodificado (ffmpeg -f framemd5)."""
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error"]
    if formato:
        cmd += ["-f", formato]
    cmd += ["-i", path, "-map", "0:v", "-f", "framemd5", "-"]
    r = subprocess.run(cmd, check=True, capture_output=True)
    return [linha.split(",")[-1].strip()
            for linha in r.stdout.decode().splitlines()
            if linha and not linha.startswith("#")]


def tipos_nal(au: bytes) -> list[int]:
    return [t for _, t in iter_nals(au)]


# ---------------------------------------------------------------- análise do MP4

@dataclass(frozen=True)
class AnaliseMp4:
    codec: str
    largura: int
    altura: int
    quadros: int
    duracao: float
    fps: float
    erros_decodificacao: str
    md5: list[str]


def analisar_mp4(path: str) -> AnaliseMp4:
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=codec_name,width,height,nb_read_frames,avg_frame_rate:format=duration",
         "-of", "json", path], check=True, capture_output=True)
    info = json.loads(r.stdout)
    s = info["streams"][0]
    num, den = s["avg_frame_rate"].split("/")
    dec = subprocess.run([FFMPEG, "-hide_banner", "-v", "error", "-i", path, "-f", "null", "-"],
                         capture_output=True)
    return AnaliseMp4(
        codec=s["codec_name"], largura=int(s["width"]), altura=int(s["height"]),
        quadros=int(s["nb_read_frames"]), duracao=float(info["format"]["duration"]),
        fps=float(num) / float(den) if float(den) else 0.0,
        erros_decodificacao=dec.stderr.decode("utf-8", "replace").strip(),
        md5=frame_md5(path))


def dimensoes_jpeg(path: str) -> tuple[int, int]:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=width,height",
                        "-of", "json", path], check=True, capture_output=True)
    s = json.loads(r.stdout)["streams"][0]
    return int(s["width"]), int(s["height"])


# ---------------------------------------------------------------- câmera simulada

@dataclass(frozen=True)
class Emissao:
    t: float      # instante (relógio da captura) em que o quadro chega ao worker
    idx: int      # índice global do quadro (idx % len(aus) = quadro do arquivo)
    key: bool


class CameraSimulada:
    """VideoSource com roteiro. Cada `open()` consome uma sessão do roteiro."""

    def __init__(self, video: Video, relogio, sessoes, quadros_por_pedaco: int = 1,
                 retoma_no_keyframe: bool = True, ao_apertar=None, seed: int = 7):
        self.video = video
        self.relogio = relogio
        self.fps = video.fps
        self._sessoes = [list(s) for s in sessoes]
        self.quadros_por_pedaco = quadros_por_pedaco
        self.retoma_no_keyframe = retoma_no_keyframe
        self.ao_apertar = ao_apertar
        self._rnd = random.Random(seed)
        self.proximo = 0
        self.emitidos: list[Emissao] = []
        self.aberturas = 0
        self.fechamentos = 0
        self._passos: list = []

    @property
    def roteiro_acabou(self) -> bool:
        return not self._sessoes

    # --- VideoSource
    def open(self) -> None:
        self.aberturas += 1
        if not self._sessoes:
            raise ConnectionRefusedError("roteiro acabou")
        self._passos = self._sessoes.pop(0)
        if self._passos and self._passos[0][0] == "recusa":
            raise ConnectionRefusedError("câmera recusou a conexão")
        if self.retoma_no_keyframe and self.proximo:
            # o relay começa cada sessão num quadro-chave (o anterior se perdeu)
            n = len(self.video.aus)
            while not is_keyframe(self.video.aus[self.proximo % n]):
                self.proximo += 1

    def chunks(self):
        yield from self._gerar()

    def close(self) -> None:
        self.fechamentos += 1

    # --- roteiro
    def _au(self) -> tuple[int, bytes]:
        idx = self.proximo
        self.proximo += 1
        return idx, self.video.aus[idx % len(self.video.aus)]

    def _gerar(self):
        grupo: list[tuple[int, bytes]] = []
        for passo in self._passos:
            tipo = passo[0]
            if tipo == "video":
                for _ in range(round(passo[1] * self.fps)):
                    self.relogio.avancar(1.0 / self.fps)
                    grupo.append(self._au())
                    if len(grupo) >= self.quadros_por_pedaco:
                        yield self._despachar(grupo)
                        grupo = []
            elif tipo == "mudo":
                self.relogio.avancar(passo[1])
            elif tipo == "perde":
                for _ in range(round(passo[1] * self.fps)):
                    self.relogio.avancar(1.0 / self.fps)
                    self._au()
            elif tipo == "lixo":
                yield bytes(self._rnd.randrange(0x10, 0xF0) for _ in range(passo[1]))
            elif tipo == "cai":
                raise ConnectionResetError("relay derrubou a conexão")
            elif tipo == "aperto":
                if grupo:
                    yield self._despachar(grupo)
                    grupo = []
                recuo = passo[2] if len(passo) > 2 else 0.0
                if self.ao_apertar is not None:
                    self.ao_apertar(passo[1], self.relogio() - recuo)
            else:
                raise ValueError("passo desconhecido: %r" % (passo,))
        if grupo:
            yield self._despachar(grupo)

    def _despachar(self, grupo) -> bytes:
        t = self.relogio()
        for idx, au in grupo:
            self.emitidos.append(Emissao(t, idx, is_keyframe(au)))
        return b"".join(au for _, au in grupo)

    # --- o que o clipe deveria conter (independente do Ring)
    def janela_esperada(self, pressed_at: float, segundos: float = 30.0) -> tuple[list[int], bool]:
        """Índices dos quadros que o clipe deve ter e se ele deve sair parcial."""
        antes = [e for e in self.emitidos if e.t <= pressed_at]
        chaves = [i for i, e in enumerate(antes) if e.key and e.t <= pressed_at - segundos]
        if chaves:
            inicio, parcial = chaves[-1], False
        else:
            primeiras = [i for i, e in enumerate(antes) if e.key]
            inicio, parcial = primeiras[0], True
        return [e.idx for e in antes[inicio:]], parcial

    def md5_esperado(self, indices: list[int]) -> list[str]:
        n = len(self.video.md5)
        return [self.video.md5[i % n] for i in indices]


# ---------------------------------------------------------------- fio XM / NetIP

def _cabecalho_xm(au: bytes, key: bool, rnd: random.Random, fps: int) -> bytes:
    """Marcador XM (00 00 01 FC/FD) + cabeçalho com tamanho, como o firmware manda."""
    if key:
        # tipo, fps, largura/8, altura/8, data/hora (4), tamanho (4)
        return (b"\x00\x00\x01\xfc" + bytes([0x02, fps, 40, 23])
                + rnd.randbytes(4).replace(b"\x00", b"\x01") + len(au).to_bytes(4, "little"))
    return b"\x00\x00\x01\xfd" + len(au).to_bytes(4, "little")


def _audio_xm(rnd: random.Random) -> bytes:
    corpo = bytes(rnd.randrange(0x55, 0xD5) for _ in range(160))
    return b"\x00\x00\x01\xfa" + bytes([0x0e, 0x02]) + len(corpo).to_bytes(2, "little") + corpo


def pacote_netip(msgid: int, payload: bytes) -> bytes:
    h = bytearray(20)
    h[0], h[1] = 0xFF, 0x01
    h[14:16] = msgid.to_bytes(2, "little")
    h[16:20] = len(payload).to_bytes(4, "little")
    return bytes(h) + payload


class SocketFalso:
    """recv() devolve pedaços de tamanho aleatório de um gerador de bytes; b'' = fechou."""

    def __init__(self, gerador, rnd: random.Random):
        self._g = gerador
        self._rnd = rnd
        self._buf = bytearray()

    def recv(self, n: int) -> bytes:
        while not self._buf:
            try:
                self._buf += next(self._g)
            except StopIteration:
                return b""
        k = min(n, self._rnd.randint(1, 4096), len(self._buf))
        out = bytes(self._buf[:k])
        del self._buf[:k]
        return out

    def close(self) -> None:
        pass


class CameraXmSimulada(CameraSimulada):
    """Mesma câmera, mas o vídeo passa pelo fio de verdade:
    quadro -> marcador XM (+ áudio) -> pacotes NetIP de tamanhos aleatórios ->
    socket que entrega pedaços quebrados -> NetIPReader -> video_chunks.

    O instante de cada quadro no anel é o da chegada (um quadro de atraso, como no
    relay real), então aqui o conteúdo é conferido por fatia contígua, não por janela.
    """

    def __init__(self, *a, com_audio: bool = True, pacotes_estranhos: bool = True, **kw):
        super().__init__(*a, **kw)
        self.com_audio = com_audio
        self.pacotes_estranhos = pacotes_estranhos

    def chunks(self):
        rnd = self._rnd

        def bytes_do_fio():
            pendente = bytearray()
            for annexb in self._gerar():
                for au in split_access_units(annexb) or [annexb]:
                    pendente += _cabecalho_xm(au, is_keyframe(au), rnd, self.fps) + au
                    if self.com_audio and rnd.random() < 0.5:
                        pendente += _audio_xm(rnd)
                # quebra o fluxo XM em pacotes NetIP de tamanho variável
                while len(pendente) > 1500:
                    k = rnd.randint(200, 1500)
                    yield pacote_netip(MSG_VIDEO, bytes(pendente[:k]))
                    del pendente[:k]
                    if self.pacotes_estranhos and rnd.random() < 0.05:
                        yield pacote_netip(1006, b'{"Ret":100}\x00')   # keep-alive, não é vídeo
            if pendente:
                yield pacote_netip(MSG_VIDEO, bytes(pendente))
            # marcador final para o último quadro sair do acumulador
            yield pacote_netip(MSG_VIDEO, b"\x00\x00\x01\xfd\x00\x00\x00\x00")

        leitor = NetIPReader(SocketFalso(bytes_do_fio(), rnd))
        yield from video_chunks(leitor)


def md5_bytes(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def caminho(*partes) -> str:
    return os.path.join(*partes)

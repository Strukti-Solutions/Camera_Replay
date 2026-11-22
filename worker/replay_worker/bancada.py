"""
bancada.py — botão virtual para testar o corte com uma câmera RTSP local.

Sobe a captura contínua (RtspSource -> CameraCapture -> Ring) e uma página em
http://127.0.0.1:<porta> com um botão. Cada aperto espera `--atraso` segundos
(o vídeo do instante do aperto precisa chegar ao anel), corta os 30 s com o
mesmo `process_job` da produção e grava MP4 + capa em
<out>/clipes/bancada/<id>.mp4. Sem Postgres e sem R2.

A URL da câmera (com a senha) vem de uma variável de ambiente, nunca da linha
de comando do Python. O ffmpeg ainda a recebe como argumento: não use em
máquina compartilhada.

Uso:
  set REPLAY_RTSP_URL=rtsp://admin:<senha>@192.168.0.50:554/onvif1
  py -m replay_worker.bancada [--udp] [--recodificar] [--porta 8787] [--atraso 2]
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .capture import CameraCapture
from .clipper import ClipJob, chave_da_capa, chave_do_clipe, process_job
from .local import LocalDirUploader, MemoryQueue
from .ring import Ring
from .source import RtspSource, ocultar_senha

ARENA = "bancada"
_ID_VALIDO = re.compile(r"^[0-9]{1,16}-[0-9]{1,6}$")
_ARQUIVO = re.compile(r"^/arquivo/([0-9]{1,16}-[0-9]{1,6})\.(mp4|jpg)$")


def _em_thread(alvo, *args) -> None:
    threading.Thread(target=alvo, args=args, daemon=True, name="corte").start()


class Bancada:
    """Estado da bancada: captura, apertos e clipes gerados."""

    def __init__(self, ring: Ring, capture, out: str, atraso: float = 2.0,
                 clock=time.time, sleep=time.sleep, processar=process_job,
                 iniciar=_em_thread):
        self.ring = ring
        self.capture = capture
        self.out = out
        self.atraso = atraso
        self._clock = clock
        self._sleep = sleep
        self._processar = processar
        self._iniciar = iniciar
        self._uploader = LocalDirUploader(out)
        self._contador = itertools.count(1)
        self._lock = threading.Lock()
        self._clipes: dict[str, dict] = {}

    def apertar(self) -> str:
        apertado = self._clock()
        clip_id = "%d-%d" % (int(apertado * 1000), next(self._contador))
        with self._lock:
            self._clipes[clip_id] = {"id": clip_id, "apertado_em": apertado,
                                     "estado": "processando"}
        self._iniciar(self._cortar, clip_id, apertado)
        return clip_id

    def _cortar(self, clip_id: str, apertado: float) -> None:
        self._sleep(self.atraso)
        fila = MemoryQueue()
        job = ClipJob(clip_id, ARENA, ARENA, apertado)
        self._processar(job, self.ring, fila, self._uploader, fps=None)
        with self._lock:
            c = self._clipes[clip_id]
            if fila.ready:
                _, _, tamanho, duracao, parcial = fila.ready[0]
                c.update(estado="pronto", tamanho=tamanho, duracao=round(duracao, 1),
                         parcial=parcial, video="/arquivo/%s.mp4" % clip_id,
                         capa="/arquivo/%s.jpg" % clip_id)
            else:
                motivo = fila.failed[0][1] if fila.failed else "erro desconhecido"
                c.update(estado="falhou", motivo=motivo)

    def clipes(self) -> list[dict]:
        with self._lock:
            lista = [dict(c) for c in self._clipes.values()]
        return sorted(lista, key=lambda c: c["apertado_em"], reverse=True)

    def status(self) -> dict:
        s = self.ring.stats()
        return {"status": self.capture.status, "fps": round(s.fps, 1),
                "quadros": s.frames, "keyframes": s.keyframes,
                "segundos": round(s.span, 1), "anel_mb": round(s.bytes / 1e6, 2),
                "erro": ocultar_senha(self.capture.last_error or "") or None}

    def caminho_arquivo(self, clip_id: str, ext: str) -> str | None:
        if not _ID_VALIDO.fullmatch(clip_id):
            return None
        job = ClipJob(clip_id, ARENA, ARENA, 0.0)
        chave = chave_do_clipe(job) if ext == "mp4" else chave_da_capa(job)
        caminho = os.path.join(self.out, *chave.split("/"))
        return caminho if os.path.isfile(caminho) else None


def servir(bancada: Bancada, porta: int = 8787, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    """Cria o servidor HTTP da página (só em localhost). Quem chama faz serve_forever."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # sem log de cada requisição
            pass

        def _enviar(self, status: int, corpo: bytes, tipo: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corpo)

        def _json(self, status: int, dados) -> None:
            self._enviar(status, json.dumps(dados).encode(), "application/json")

        def do_GET(self):
            if self.path == "/":
                return self._enviar(200, PAGINA.encode(), "text/html; charset=utf-8")
            if self.path == "/status":
                return self._json(200, bancada.status())
            if self.path == "/clipes":
                return self._json(200, {"clipes": bancada.clipes()})
            m = _ARQUIVO.fullmatch(self.path)
            caminho = bancada.caminho_arquivo(m.group(1), m.group(2)) if m else None
            if m is None or caminho is None:
                return self._json(404, {"erro": "não encontrado"})
            with open(caminho, "rb") as f:
                dados = f.read()
            self._enviar(200, dados, "video/mp4" if m.group(2) == "mp4" else "image/jpeg")

        def do_POST(self):
            if self.path != "/aperto":
                return self._json(404, {"erro": "não encontrado"})
            # cabeçalho próprio: outro site não consegue enviá-lo sem preflight (que não respondemos)
            if self.headers.get("X-Bancada") != "1":
                return self._json(403, {"erro": "use o botão da página"})
            self._json(202, {"id": bancada.apertar()})

    return ThreadingHTTPServer((host, porta), Handler)


PAGINA = """<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bancada do replay</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;background:#0f1115;color:#e8e8e8}
 main{max-width:860px;margin:auto;padding:24px}
 h1{font-size:20px;margin:0 0 4px} #st{color:#9aa;font-size:14px;min-height:1.4em}
 #botao{display:block;margin:28px auto;width:200px;height:200px;border-radius:50%;border:0;
  background:#e5484d;color:#fff;font-size:26px;font-weight:700;cursor:pointer;
  box-shadow:0 8px 0 #9b2c30}
 #botao:active{transform:translateY(6px);box-shadow:0 2px 0 #9b2c30}
 .c{background:#181b22;border-radius:10px;padding:12px;margin:12px 0}
 .c video{width:100%;border-radius:6px;margin-top:8px}
 .falhou{color:#ff8a8a} .on{color:#5fd38d} .off{color:#ff8a8a}
</style></head><body><main>
<h1>Bancada do replay</h1>
<div id="st">conectando…</div>
<button id="botao">REPLAY</button>
<div id="lista"></div>
</main><script>
const st=document.getElementById('st'),lista=document.getElementById('lista');
const vistos=new Set();
async function status(){
  try{const s=await (await fetch('/status')).json();
    st.innerHTML='câmera <b class="'+(s.status==='online'?'on':'off')+'">'+s.status+'</b> · '
      +s.fps+' fps · '+s.segundos+' s no anel · '+s.keyframes+' keyframes · '+s.anel_mb+' MB'
      +(s.erro?' · erro: '+s.erro.replace(/</g,'&lt;'):'');}catch(e){st.textContent='bancada fora do ar';}
}
async function clipes(){
  const {clipes}=await (await fetch('/clipes')).json();
  for(const c of clipes){
    let el=document.getElementById('c'+c.id);
    if(!el){el=document.createElement('div');el.className='c';el.id='c'+c.id;lista.prepend(el);}
    if(vistos.has(c.id+c.estado))continue; vistos.add(c.id+c.estado);
    const h=new Date(c.apertado_em*1000).toLocaleTimeString('pt-BR');
    if(c.estado==='pronto') el.innerHTML='<b>'+h+'</b> · '+c.duracao+' s · '+(c.tamanho/1e6).toFixed(1)
      +' MB'+(c.parcial?' · parcial':'')+' · <a href="'+c.video+'" download>baixar</a>'
      +'<video controls preload="metadata" poster="'+c.capa+'" src="'+c.video+'"></video>';
    else if(c.estado==='falhou') el.innerHTML='<b>'+h+'</b> · <span class="falhou">falhou: '
      +c.motivo.replace(/</g,'&lt;')+'</span>';
    else el.innerHTML='<b>'+h+'</b> · cortando…';
  }
}
document.getElementById('botao').onclick=async()=>{
  await fetch('/aperto',{method:'POST',headers:{'X-Bancada':'1'}}); clipes();
};
status();clipes();setInterval(status,2000);setInterval(clipes,1500);
</script></body></html>
"""


def argumentos(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Botão virtual: captura RTSP local e corta 30 s a cada aperto.")
    ap.add_argument("--url-env", default="REPLAY_RTSP_URL",
                    help="variável de ambiente com a URL rtsp:// (padrão REPLAY_RTSP_URL)")
    ap.add_argument("--recodificar", action="store_true",
                    help="recodifica para H.264 (câmera em H.265 ou keyframe espaçado)")
    ap.add_argument("--udp", action="store_true",
                    help="RTSP por UDP (câmera que recusa TCP: 'Nonmatching transport')")
    ap.add_argument("--fps", type=int, default=10, help="fps usado no keyframe ao recodificar")
    ap.add_argument("--porta", type=int, default=8787)
    ap.add_argument("--atraso", type=float, default=2.0,
                    help="segundos de espera após o aperto antes de cortar")
    ap.add_argument("--out", default="out")
    return ap.parse_args(argv)


def main() -> int:
    a = argumentos()

    url = os.environ.get(a.url_env, "").strip()
    if not url.startswith("rtsp://"):
        print("defina %s com a URL rtsp:// da câmera" % a.url_env, file=sys.stderr)
        return 2

    ring = Ring()
    cap = CameraCapture("bancada", lambda: RtspSource(
        url, recodificar=a.recodificar, fps=a.fps, transporte="udp" if a.udp else "tcp"), ring)
    parar = threading.Event()
    threading.Thread(target=cap.run_forever, args=(parar,), daemon=True, name="captura").start()

    bancada = Bancada(ring, cap, a.out, atraso=a.atraso)
    srv = servir(bancada, a.porta)
    print("câmera: %s" % ocultar_senha(url))
    print("abra http://127.0.0.1:%d  (Ctrl+C para sair)" % a.porta)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        parar.set()
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

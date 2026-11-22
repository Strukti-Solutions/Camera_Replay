"""
botao_virtual.py — botão virtual que aperta o botão de verdade na API do app.

Página em http://127.0.0.1:<porta> com um botão. Cada aperto faz, pelo
servidor local (a API não tem CORS e o token não vai para o navegador),
POST <APP_URL>/api/botao/aperto com "Authorization: Bearer <token>". Daí em
diante é o fluxo de produção: fila no Postgres -> worker -> R2 -> /a/<slug>.

O token vem de uma variável de ambiente e nunca aparece na página nem nos logs.

Uso:
  $env:REPLAY_BOTAO_TOKEN = "<token de 43 caracteres mostrado no /admin>"
  py -m replay_worker.botao_virtual --app https://camera-replay.vercel.app
      [--arena https://camera-replay.vercel.app/a/<slug>] [--porta 8788]
"""
from __future__ import annotations

import argparse
import html
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class BotaoReal:
    def __init__(self, app_url: str, token: str, abrir=urllib.request.urlopen,
                 clock=time.time, timeout: float = 15.0):
        if not app_url.startswith("https://"):
            raise ValueError("a URL do app precisa ser https://")
        self._url = app_url.rstrip("/") + "/api/botao/aperto"
        self._token = token
        self._abrir = abrir
        self._clock = clock
        self._timeout = timeout
        self._lock = threading.Lock()
        self._apertos: list[dict] = []

    def __repr__(self) -> str:
        return "BotaoReal(%r)" % self._url

    def apertar(self) -> dict:
        em = self._clock()
        req = urllib.request.Request(self._url, data=b"", method="POST",
                                     headers={"Authorization": "Bearer " + self._token})
        try:
            with self._abrir(req, timeout=self._timeout) as resp:
                corpo = json.loads(resp.read() or b"{}")
                r = {"ok": True, "status": resp.status, "clipe_id": corpo.get("clipe_id"),
                     "duplicado": bool(corpo.get("duplicado")), "em": em}
        except urllib.error.HTTPError as e:
            try:
                erro = json.loads(e.read() or b"{}").get("erro") or e.reason
            except ValueError:
                erro = e.reason
            r = {"ok": False, "status": e.code, "erro": str(erro)[:200], "em": em}
        except (urllib.error.URLError, OSError) as e:
            r = {"ok": False, "status": None, "erro": "sem conexão (%s)" % type(e).__name__, "em": em}
        with self._lock:
            self._apertos.insert(0, r)
        return r

    def apertos(self) -> list[dict]:
        with self._lock:
            return [dict(a) for a in self._apertos]


def servir(botao: BotaoReal, porta: int = 8788, host: str = "127.0.0.1",
           pagina_arena: str | None = None) -> ThreadingHTTPServer:
    link = ""
    if pagina_arena and pagina_arena.startswith("https://"):
        u = html.escape(pagina_arena, quote=True)
        link = '<p><a href="%s" target="_blank" rel="noopener">abrir a página da arena</a></p>' % u
    pagina = PAGINA.replace("<!--LINK-->", link).encode()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
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
                return self._enviar(200, pagina, "text/html; charset=utf-8")
            if self.path == "/apertos":
                return self._json(200, {"apertos": botao.apertos()})
            self._json(404, {"erro": "não encontrado"})

        def do_POST(self):
            if self.path != "/aperto":
                return self._json(404, {"erro": "não encontrado"})
            if self.headers.get("X-Bancada") != "1":
                return self._json(403, {"erro": "use o botão da página"})
            self._json(200, botao.apertar())

    return ThreadingHTTPServer((host, porta), Handler)


PAGINA = """<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Botão virtual do replay</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;background:#0f1115;color:#e8e8e8}
 main{max-width:720px;margin:auto;padding:24px} h1{font-size:20px;margin:0}
 a{color:#7cb7ff} p{color:#9aa;font-size:14px}
 #botao{display:block;margin:28px auto;width:200px;height:200px;border-radius:50%;border:0;
  background:#e5484d;color:#fff;font-size:26px;font-weight:700;cursor:pointer;box-shadow:0 8px 0 #9b2c30}
 #botao:active{transform:translateY(6px);box-shadow:0 2px 0 #9b2c30}
 #botao:disabled{opacity:.6}
 .a{background:#181b22;border-radius:10px;padding:10px 12px;margin:8px 0;font-size:14px}
 .ok{color:#5fd38d} .erro{color:#ff8a8a}
</style></head><body><main>
<h1>Botão virtual do replay</h1>
<p>Cada aperto chama a API de produção, como o botão físico.</p>
<!--LINK-->
<button id="botao">REPLAY</button>
<div id="lista"></div>
</main><script>
const lista=document.getElementById('lista'),botao=document.getElementById('botao');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function carregar(){
  const {apertos}=await (await fetch('/apertos')).json();
  lista.innerHTML=apertos.map(a=>{
    const h=new Date(a.em*1000).toLocaleTimeString('pt-BR');
    return '<div class="a"><b>'+h+'</b> · '+(a.ok
      ? '<span class="ok">'+a.status+' aceito</span> · clipe '+esc(a.clipe_id)+(a.duplicado?' (duplicado)':'')
      : '<span class="erro">'+esc(a.status??'rede')+' · '+esc(a.erro)+'</span>')+'</div>';}).join('');
}
botao.onclick=async()=>{botao.disabled=true;
  try{await fetch('/aperto',{method:'POST',headers:{'X-Bancada':'1'}});}finally{botao.disabled=false;}
  carregar();};
carregar();
</script></body></html>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description="Botão virtual: aperta o botão na API de produção.")
    ap.add_argument("--app", default=os.environ.get("APP_URL", ""),
                    help="URL do app (padrão: APP_URL), ex.: https://camera-replay.vercel.app")
    ap.add_argument("--token-env", default="REPLAY_BOTAO_TOKEN")
    ap.add_argument("--arena", default=None, help="link da página /a/<slug> para abrir")
    ap.add_argument("--porta", type=int, default=8788)
    a = ap.parse_args()

    token = os.environ.get(a.token_env, "").strip()
    if len(token) != 43:
        print("defina %s com o token de 43 caracteres do botão" % a.token_env, file=sys.stderr)
        return 2
    try:
        botao = BotaoReal(a.app, token)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 2
    srv = servir(botao, a.porta, pagina_arena=a.arena)
    print("abra http://127.0.0.1:%d  (Ctrl+C para sair)" % a.porta)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Cliente mínimo do XMCloud (protocolo JFTECH): POST cifrado por XOR.

Portado de camera/src/xmcloud.py (só jftech_post).
"""
import base64
import json
import re
import ssl
import time
import urllib.request

from . import crypto

UA = "funsdk-v1.8.2-Android"
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE   # DÍVIDA (bloqueia produção): TLS sem verificação; ver docs/divida-worker.md


def _b64fix(s):
    s = re.sub(r"[^A-Za-z0-9+/=]", "", s).rstrip("=")
    return base64.b64decode(s + "=" * (-len(s) % 4))


def jftech_post(url, obj, timeout=10):
    """Envia um objeto JSON cifrado (JFTECH) e devolve o JSON decifrado da resposta."""
    ts = int(time.time() * 1000)
    nonce = crypto.nonce(8)
    key = "%d%s" % (ts, nonce)
    body = base64.b64encode(crypto.xor_crypt(json.dumps(obj).encode("utf-8"), key))
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "text/plain")
    req.add_header("JFTECH-EV", "3")
    req.add_header("JFTECH-REQ", nonce)
    req.add_header("JFTECH-TIME", str(ts))
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "*/*")
    with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
        raw = r.read()
        rt = r.headers.get("JFTECH-TIME")
        rq = r.headers.get("JFTECH-REQ")
    if not (rt and rq):
        raise RuntimeError("resposta sem headers JFTECH (key indisponível): %r" % raw[:80])
    pt = crypto.xor_crypt(_b64fix(raw.decode("latin1")), rt + rq)
    return json.loads(pt.decode("utf-8", "replace"))

"""Envio e remoção de objetos no R2 (API S3) com AWS SigV4, só biblioteca padrão.

Nenhuma mensagem de erro ou repr inclui o segredo, o cabeçalho Authorization
ou a URL assinada.
"""
from __future__ import annotations

import hashlib
import hmac
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

REGIAO = "auto"
SERVICO = "s3"


class R2Error(Exception):
    """Falha ao falar com o R2. `status` é o HTTP, ou 0 para falha de rede."""

    def __init__(self, status: int):
        super().__init__("R2 respondeu com falha (status %d)" % status if status else
                         "R2 inalcançável (falha de rede)")
        self.status = status


def _hmac(chave: bytes, msg: str) -> bytes:
    return hmac.new(chave, msg.encode("utf-8"), hashlib.sha256).digest()


def _assinar(metodo: str, caminho: str, cabecalhos: dict[str, str], hash_corpo: str,
             segredo: str, amz_date: str, regiao: str, servico: str,
             query: str = "") -> tuple[str, str]:
    """Calcula a assinatura SigV4. `caminho` já vem codificado.

    Devolve (assinatura em hex, lista de cabeçalhos assinados).
    """
    norm = {k.lower(): " ".join(v.split()) for k, v in cabecalhos.items()}
    nomes = sorted(norm)
    canonicos = "".join("%s:%s\n" % (n, norm[n]) for n in nomes)
    assinados = ";".join(nomes)
    requisicao = "\n".join([metodo, caminho, query, canonicos, assinados, hash_corpo])
    dia = amz_date[:8]
    escopo = "%s/%s/%s/aws4_request" % (dia, regiao, servico)
    a_assinar = "\n".join(["AWS4-HMAC-SHA256", amz_date, escopo,
                           hashlib.sha256(requisicao.encode("utf-8")).hexdigest()])
    k = _hmac(("AWS4" + segredo).encode("utf-8"), dia)
    for parte in (regiao, servico, "aws4_request"):
        k = _hmac(k, parte)
    return hmac.new(k, a_assinar.encode("utf-8"), hashlib.sha256).hexdigest(), assinados


class R2Uploader:
    """Cliente mínimo do R2: `put` e `delete` (protocolo `Uploader` do clipper)."""

    def __init__(self, account_id: str, access_key_id: str, secret_access_key: str, bucket: str,
                 opener=urllib.request.urlopen, clock=time.time, timeout: float = 60.0):
        self._host = "%s.r2.cloudflarestorage.com" % account_id
        self._akid = access_key_id
        self._segredo = secret_access_key
        self._bucket = bucket
        self._opener = opener
        self._clock = clock
        self._timeout = timeout

    def __repr__(self) -> str:
        return "R2Uploader(bucket=%r)" % self._bucket

    def _caminho(self, key: str) -> str:
        segs = [urllib.parse.quote(s, safe="-_.~") for s in key.split("/")]
        return "/%s/%s" % (urllib.parse.quote(self._bucket, safe="-_.~"), "/".join(segs))

    def _enviar(self, metodo: str, key: str, corpo: bytes, extras: dict[str, str]) -> int:
        caminho = self._caminho(key)
        hash_corpo = hashlib.sha256(corpo).hexdigest()
        amz_date = datetime.fromtimestamp(self._clock(), timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        cab = {"host": self._host, "x-amz-content-sha256": hash_corpo, "x-amz-date": amz_date}
        cab.update({k.lower(): v for k, v in extras.items()})
        assinatura, assinados = _assinar(metodo, caminho, cab, hash_corpo, self._segredo,
                                         amz_date, REGIAO, SERVICO)
        cab["Authorization"] = "AWS4-HMAC-SHA256 Credential=%s/%s/%s/%s/aws4_request, SignedHeaders=%s, Signature=%s" % (
            self._akid, amz_date[:8], REGIAO, SERVICO, assinados, assinatura)
        del cab["host"]  # o urllib põe o Host a partir da URL
        req = urllib.request.Request("https://%s%s" % (self._host, caminho),
                                     data=corpo if metodo == "PUT" else None,
                                     headers=cab, method=metodo)
        try:
            with self._opener(req, timeout=self._timeout) as resp:
                return int(resp.status)
        except urllib.error.HTTPError as exc:
            return exc.code
        except Exception:
            # Falha de rede/TLS: sem detalhes, a mensagem original pode ter a URL.
            raise R2Error(0) from None

    def put(self, key: str, data: bytes) -> None:
        status = self._enviar("PUT", key, data, {"Content-Type": "video/mp4"})
        if not 200 <= status < 300:
            raise R2Error(status)

    def delete(self, key: str) -> None:
        status = self._enviar("DELETE", key, b"", {})
        if status not in (200, 204, 404):
            raise R2Error(status)

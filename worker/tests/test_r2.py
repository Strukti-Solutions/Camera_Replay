"""Testes do R2Uploader: SigV4 da biblioteca padrão, sem rede."""
import hashlib
import urllib.error

import pytest

from replay_worker import r2
from replay_worker.r2 import R2Error, R2Uploader

SEGREDO = "segredo-super-secreto-123"


class RespostaFalsa:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return b""


class OpenerFalso:
    """Registra a requisição e devolve (ou lança) o status combinado."""

    def __init__(self, status=200, lanca_http=False):
        self.status = status
        self.lanca_http = lanca_http
        self.reqs = []

    def __call__(self, req, timeout=None):
        self.reqs.append(req)
        if self.lanca_http and self.status >= 400:
            raise urllib.error.HTTPError(req.full_url, self.status, "x", {}, None)
        return RespostaFalsa(self.status)


def _up(opener):
    return R2Uploader("acc123", "AKIDEXEMPLO", SEGREDO, "bkt", opener=opener, clock=lambda: 1_700_000_000)


def test_assinatura_reproduz_exemplo_oficial_aws_put():
    # Exemplo "PUT Object" da AWS (Authorization header, payload em um único bloco).
    corpo = b"Welcome to Amazon S3."
    sha = hashlib.sha256(corpo).hexdigest()
    assert sha == "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"
    cab = {
        "date": "Fri, 24 May 2013 00:00:00 GMT",
        "host": "examplebucket.s3.amazonaws.com",
        "x-amz-content-sha256": sha,
        "x-amz-date": "20130524T000000Z",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
    }
    assinatura, assinados = r2._assinar(
        "PUT", "/test%24file.text", cab, sha,
        "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "20130524T000000Z", "us-east-1", "s3")
    assert assinados == "date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class"
    assert assinatura == "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"


def test_put_monta_requisicao_assinada():
    op = OpenerFalso()
    _up(op).put("clipes/a/b.mp4", b"dados")
    req = op.reqs[0]
    assert req.get_method() == "PUT"
    assert req.full_url == "https://acc123.r2.cloudflarestorage.com/bkt/clipes/a/b.mp4"
    auth = req.get_header("Authorization")
    assert "Credential=AKIDEXEMPLO/20231114/auto/s3/aws4_request" in auth
    assert req.get_header("Content-type") == "video/mp4"
    assert req.get_header("X-amz-content-sha256") == hashlib.sha256(b"dados").hexdigest()
    assert req.data == b"dados"


def test_delete_404_nao_lanca_e_204_tambem():
    for st in (404, 204):
        op = OpenerFalso(st, lanca_http=True)
        _up(op).delete("clipes/a/b.mp4")
        assert op.reqs[0].get_method() == "DELETE"


@pytest.mark.parametrize("lanca", [True, False])
def test_delete_500_lanca_sem_segredo(lanca):
    with pytest.raises(R2Error) as ei:
        _up(OpenerFalso(500, lanca_http=lanca)).delete("clipes/a/b.mp4")
    assert ei.value.status == 500
    msg = str(ei.value) + repr(ei.value)
    assert SEGREDO not in msg and "Signature" not in msg and "r2.cloudflarestorage" not in msg


def test_put_erro_de_rede_vira_r2error_status_0():
    def opener(req, timeout=None):
        raise OSError("sem rede")
    with pytest.raises(R2Error) as ei:
        _up(opener).put("k", b"x")
    assert ei.value.status == 0


def test_chave_codificada_por_segmento_preservando_barras():
    op = OpenerFalso()
    _up(op).put("clipes/arena 1/a#b.mp4", b"x")
    assert op.reqs[0].full_url.endswith("/bkt/clipes/arena%201/a%23b.mp4")


def test_repr_nao_mostra_segredo():
    assert SEGREDO not in repr(_up(OpenerFalso()))

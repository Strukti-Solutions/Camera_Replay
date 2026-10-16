import pytest

from replay_worker.xm.relay import CameraCreds, RelayError, _check_remote


def test_repr_nao_expoe_segredos():
    r = repr(CameraCreds("SN1", "AUTH-SECRETO", "u", "SENHA-SECRETA"))
    assert "AUTH-SECRETO" not in r and "SENHA-SECRETA" not in r
    assert "SN1" in r


@pytest.mark.parametrize("host,port", [("8.8.8.8", 6611), ("x.secu100.net", 6510)])
def test_check_remote_aceita(host, port):
    _check_remote(host, port)


@pytest.mark.parametrize("host,port", [
    ("127.0.0.1", 6510), ("10.0.0.5", 6510), ("192.168.1.1", 6510),
    ("169.254.1.1", 6510), ("evil.example.com", 6510),
    ("8.8.8.8", 0), ("8.8.8.8", 70000),
])
def test_check_remote_recusa(host, port):
    with pytest.raises(RelayError):
        _check_remote(host, port)

"""Testes da decifragem das credenciais da câmera (formato v1 do app)."""
import base64
import json
from pathlib import Path

import pytest

from replay_worker.creds import decifrar_credenciais, ler_chave

VETOR = json.loads(
    (Path(__file__).resolve().parents[2] / "tests" / "vetor-credenciais.json").read_text("utf-8")
)
CHAVE = ler_chave(VETOR["chave_base64"])


def _troca_byte(parte_b64: str) -> str:
    """Devolve a parte em base64 com o primeiro byte alterado."""
    b = bytearray(base64.b64decode(parte_b64))
    b[0] ^= 0x01
    return base64.b64encode(bytes(b)).decode()


def test_vetor_do_app_decifra_os_tres_campos():
    c = decifrar_credenciais(VETOR["cifrado"], CHAVE, "SN1", "quadra")
    esperado = VETOR["credenciais"]
    assert c.authcode == esperado["authcode"]
    assert c.local_user == esperado["local_user"]
    assert c.local_pwd == esperado["local_pwd"]
    assert c.sn == "SN1" and c.name == "quadra"


@pytest.mark.parametrize("indice", [1, 2, 3])  # iv, tag, cifra
def test_byte_trocado_falha(indice):
    partes = VETOR["cifrado"].split(":")
    partes[indice] = _troca_byte(partes[indice])
    with pytest.raises(ValueError, match="credencial inválida"):
        decifrar_credenciais(":".join(partes), CHAVE, "SN1")


def test_versao_diferente_falha():
    with pytest.raises(ValueError):
        decifrar_credenciais("v2:" + VETOR["cifrado"][3:], CHAVE, "SN1")


@pytest.mark.parametrize("texto", ["", "v1", "v1:a:b", "v1:!!:!!:!!", "v1:a:b:c:d"])
def test_formato_quebrado_falha(texto):
    with pytest.raises(ValueError, match="credencial inválida"):
        decifrar_credenciais(texto, CHAVE, "SN1")


def test_chave_de_tamanho_errado_falha():
    curta = base64.b64encode(b"\x01" * 31).decode()
    with pytest.raises(ValueError, match="CAMERA_CRED_KEY inválida"):
        ler_chave(curta)
    with pytest.raises(ValueError):
        decifrar_credenciais(VETOR["cifrado"], b"\x01" * 31, "SN1")


@pytest.mark.parametrize("b64", ["", "não-é-base64", VETOR["chave_base64"][:-1]])
def test_chave_malformada_falha(b64):
    with pytest.raises(ValueError, match="CAMERA_CRED_KEY inválida"):
        ler_chave(b64)


def test_ler_chave_aplica_strip():
    assert ler_chave("  " + VETOR["chave_base64"] + "\n") == CHAVE


def test_mensagem_de_erro_nao_vaza_segredo():
    partes = VETOR["cifrado"].split(":")
    partes[3] = _troca_byte(partes[3])
    ruim = ":".join(partes)
    with pytest.raises(ValueError) as e:
        decifrar_credenciais(ruim, CHAVE, "SN1")
    msg = str(e.value)
    for segredo in (*VETOR["credenciais"].values(), VETOR["chave_base64"], ruim, partes[3]):
        assert segredo not in msg
    with pytest.raises(ValueError) as e:
        ler_chave(VETOR["chave_base64"][:-1])
    assert VETOR["chave_base64"][:-1] not in str(e.value)


def _cifra(obj, chave=CHAVE) -> str:
    """Monta um texto v1 válido com o conteúdo dado."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = b"\x07" * 12
    bruto = AESGCM(chave).encrypt(iv, json.dumps(obj).encode(), None)
    b = base64.b64encode
    return f"v1:{b(iv).decode()}:{b(bruto[-16:]).decode()}:{b(bruto[:-16]).decode()}"


@pytest.mark.parametrize("obj", [
    {"authcode": "a", "local_user": "u"},
    {"authcode": 1, "local_user": "u", "local_pwd": "p"},
    ["a", "u", "p"],
])
def test_json_sem_os_campos_falha(obj):
    with pytest.raises(ValueError, match="credencial inválida"):
        decifrar_credenciais(_cifra(obj), CHAVE, "SN1")

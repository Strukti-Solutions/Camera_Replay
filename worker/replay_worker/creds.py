"""Decifragem das credenciais da câmera (formato v1 gerado pelo app).

Formato: ``v1:<iv>:<tag>:<cifra>``, partes em base64, AES-256-GCM. A cifra
não inclui a tag; a biblioteca espera ``cifra || tag``. Nenhuma mensagem de
erro cita a chave, o texto recebido nem as credenciais.
"""
from __future__ import annotations

import base64
import binascii
import json

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from replay_worker.xm.relay import CameraCreds

_TAM_CHAVE = 32
_TAM_IV = 12
_TAM_TAG = 16


def ler_chave(b64: str) -> bytes:
    """Lê a CAMERA_CRED_KEY: base64 canônico de exatamente 32 bytes."""
    try:
        bruto = base64.b64decode(b64.strip(), validate=True)
    except (binascii.Error, ValueError, AttributeError):
        raise ValueError("CAMERA_CRED_KEY inválida") from None
    if len(bruto) != _TAM_CHAVE:
        raise ValueError("CAMERA_CRED_KEY inválida")
    return bruto


def decifrar_credenciais(texto: str, chave: bytes, sn: str, nome: str = "") -> CameraCreds:
    """Decifra o texto v1 e devolve as credenciais; qualquer falha vira ValueError."""
    try:
        if not isinstance(chave, (bytes, bytearray)) or len(chave) != _TAM_CHAVE:
            raise ValueError
        partes = texto.split(":")
        if len(partes) != 4 or partes[0] != "v1":
            raise ValueError
        iv, tag, cifra = (base64.b64decode(p, validate=True) for p in partes[1:])
        if len(iv) != _TAM_IV or len(tag) != _TAM_TAG:
            raise ValueError
        dados = json.loads(AESGCM(bytes(chave)).decrypt(iv, cifra + tag, None))
        campos = [dados[k] for k in ("authcode", "local_user", "local_pwd")]
        if not all(isinstance(v, str) for v in campos):
            raise ValueError
    except Exception:
        # Mensagem fixa e sem encadeamento: nada do conteúdo pode vazar.
        raise ValueError("credencial inválida") from None
    return CameraCreds(sn=sn, authcode=campos[0], local_user=campos[1],
                       local_pwd=campos[2], name=nome)

"""Cripto mínima do FunSDK usada no acesso remoto (XOR, nonce, hash sofia).

Portado de camera/src/xmcrypto.py (sem a parte de credenciais da conta).
"""
import hashlib
import random
import string


def xor_crypt(data: bytes, key) -> bytes:
    """out[i] = in[i] ^ key[i % len(key)] (XorEncrypt/XorDecrypt do SDK)."""
    kb = key.encode("utf-8") if isinstance(key, str) else key
    if not kb:
        return bytes(data)
    return bytes(data[i] ^ kb[i % len(kb)] for i in range(len(data)))


def nonce(n: int = 8) -> str:
    alfa = string.ascii_letters + string.digits
    return "".join(random.choice(alfa) for _ in range(n))


def sofia_hash(password: str) -> str:
    """Hash 'sofia' do login DVRIP local."""
    m = hashlib.md5(password.encode("utf-8")).digest()
    out = ""
    for i in range(8):
        n = (m[2 * i] + m[2 * i + 1]) % 62
        if n < 10:
            out += chr(n + 48)
        elif n < 36:
            out += chr(n + 55)
        else:
            out += chr(n + 61)
    return out

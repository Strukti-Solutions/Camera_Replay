from replay_worker.xm.crypto import nonce, sofia_hash, xor_crypt


def test_sofia_hash_vetor_conhecido():
    assert sofia_hash("admin") == "6QNMIQGe"
    assert sofia_hash("") == "tlJwpbo6"


def test_xor_ida_e_volta():
    assert xor_crypt(xor_crypt(b"ola mundo", "chave"), "chave") == b"ola mundo"
    assert xor_crypt(b"abc", b"") == b"abc"


def test_nonce_tem_o_tamanho_pedido_e_e_alfanumerico():
    n = nonce(8)
    assert len(n) == 8 and n.isalnum()

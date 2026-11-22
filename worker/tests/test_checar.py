import pytest

from replay_worker.checar import checar_url_banco, ler_env, mascarar


def test_mascarar_tira_segredo_e_senha_de_url():
    msg = "falhou rtsp://admin:abc@1.2.3.4/x com senha s3nh4XYZ"
    assert mascarar(msg, ["s3nh4XYZ"]) == "falhou rtsp://admin:***@1.2.3.4/x com senha ***"


@pytest.mark.parametrize("url,trecho", [
    ("mysql://x", "postgresql://"),
    ("postgresql://postgres:[SENHA]@h:5432/postgres", "colchetes"),
    ("postgresql://postgres:s@db.abc.supabase.co:5432/postgres", "pooler"),
])
def test_url_do_banco_com_problema(url, trecho):
    assert trecho in checar_url_banco(url)


def test_url_do_pooler_passa():
    assert checar_url_banco(
        "postgresql://postgres.abc:s@aws-0-us-east-1.pooler.supabase.com:5432/postgres") is None


def test_ler_env_ignora_comentario_e_bom(tmp_path):
    p = tmp_path / ".env"
    p.write_text("﻿# comentário\nA=1\n B = dois \n", encoding="utf-8")
    assert ler_env(str(p)) == {"A": "1", "B": "dois"}

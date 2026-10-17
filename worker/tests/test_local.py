import pytest

from replay_worker.local import LocalDirUploader


def test_put_grava_na_chave_relativa(tmp_path):
    up = LocalDirUploader(str(tmp_path))
    up.put("clipes/a/b.mp4", b"xyz")
    assert (tmp_path / "clipes" / "a" / "b.mp4").read_bytes() == b"xyz"
    # sem arquivo temporário sobrando
    assert [p.name for p in (tmp_path / "clipes" / "a").iterdir()] == ["b.mp4"]


@pytest.mark.parametrize("chave", ["../x.mp4", "/x.mp4", "clipes/../../x.mp4", "C:/x.mp4", ""])
def test_chave_invalida_lanca_valueerror(tmp_path, chave):
    up = LocalDirUploader(str(tmp_path))
    with pytest.raises(ValueError):
        up.put(chave, b"x")
    with pytest.raises(ValueError):
        up.delete(chave)


def test_delete_remove_e_inexistente_nao_lanca(tmp_path):
    up = LocalDirUploader(str(tmp_path))
    up.put("clipes/a/b.mp4", b"x")
    up.delete("clipes/a/b.mp4")
    assert not (tmp_path / "clipes" / "a" / "b.mp4").exists()
    up.delete("clipes/a/b.mp4")

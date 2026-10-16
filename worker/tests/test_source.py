from replay_worker.source import FileSource
from tests.helpers import KEY, P


def test_filesource_gera_um_quadro_por_vez_no_ritmo_do_fps(tmp_path):
    f = tmp_path / "v.h264"
    f.write_bytes(KEY + P + P)
    pausas = []
    src = FileSource(str(f), fps=10.0, loop=False, sleep=pausas.append)
    src.open()
    assert list(src.chunks()) == [KEY, P, P]
    assert pausas == [0.1, 0.1, 0.1]
    src.close()


def test_filesource_em_loop_repete_o_arquivo(tmp_path):
    f = tmp_path / "v.h264"
    f.write_bytes(KEY + P)
    src = FileSource(str(f), fps=10.0, loop=True, sleep=lambda s: None)
    src.open()
    it = src.chunks()
    assert [next(it) for _ in range(5)] == [KEY, P, KEY, P, KEY]

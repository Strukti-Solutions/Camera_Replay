"""local.py — fila em memória e uploader em pasta, para a bancada e o smoke test."""
import os
import tempfile

from .clipper import ClipJob


class MemoryQueue:
    def __init__(self, jobs: list[ClipJob] | None = None):
        self.pending = list(jobs or [])
        self.ready: list[tuple] = []
        self.failed: list[tuple] = []

    def claim_pending(self, camera_id: str) -> list[ClipJob]:
        mine = [j for j in self.pending if j.camera_id == camera_id]
        self.pending = [j for j in self.pending if j.camera_id != camera_id]
        return mine

    def mark_ready(self, clip_id, key, size, duration, partial):
        self.ready.append((clip_id, key, size, duration, partial))
        return True

    def mark_failed(self, clip_id, reason):
        self.failed.append((clip_id, reason))


class LocalDirUploader:
    def __init__(self, directory: str):
        self.directory = directory
        os.makedirs(directory, exist_ok=True)

    def _caminho(self, key: str) -> str:
        """Resolve a chave como caminho relativo dentro da pasta; recusa fuga."""
        if (not key or os.path.isabs(key) or key.startswith(("/", "\\"))
                or os.path.splitdrive(key)[0]):
            raise ValueError("chave inválida")
        if ".." in key.replace("\\", "/").split("/"):
            raise ValueError("chave inválida")
        base = os.path.realpath(self.directory)
        path = os.path.realpath(os.path.join(base, key))
        if os.path.commonpath([base, path]) != base or path == base:
            raise ValueError("chave inválida")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._caminho(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # escrita atômica: arquivo temporário na mesma pasta + os.replace
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise

    def delete(self, key: str) -> None:
        try:
            os.remove(self._caminho(key))
        except FileNotFoundError:
            pass

"""local.py — fila em memória e uploader em pasta, para a bancada e o smoke test."""
import os

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

    def mark_failed(self, clip_id, reason):
        self.failed.append((clip_id, reason))


class LocalDirUploader:
    def __init__(self, directory: str):
        self.directory = directory
        os.makedirs(directory, exist_ok=True)

    def upload(self, clip_id: str, mp4: bytes) -> str:
        path = os.path.join(self.directory, "%s.mp4" % clip_id)
        with open(path, "wb") as f:
            f.write(mp4)
        return path

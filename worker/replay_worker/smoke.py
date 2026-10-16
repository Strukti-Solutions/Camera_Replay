"""
smoke.py — teste de bancada com a câmera real.

Conecta pelo relay, enche o anel por --wait segundos, simula um aperto "agora",
corta 30 s e grava o MP4 em --out. Imprime as medidas que o spec pede validar:
fps real, bitrate, intervalo entre keyframes e tamanho do anel.

Uso: py -m replay_worker.smoke --sn <SN> --wait 45
"""
import argparse
import threading
import time

from .capture import CameraCapture
from .clipper import ClipJob, process_job
from .config import load_cameras
from .local import LocalDirUploader, MemoryQueue
from .ring import Ring
from .source import RelaySource


def main() -> int:
    ap = argparse.ArgumentParser(description="Teste de bancada: conecta, enche o anel e corta um clipe.")
    ap.add_argument("--sn", required=True)
    ap.add_argument("--cameras", default="cameras.json")
    ap.add_argument("--wait", type=float, default=45.0, help="segundos de captura antes do aperto")
    ap.add_argument("--fps", type=float, default=15.0, help="fps usado no MP4 (compare com o medido)")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()

    cams = load_cameras(a.cameras)
    if a.sn not in cams:
        print("[-] SN desconhecido. Disponíveis:", ", ".join(cams))
        return 2

    ring = Ring()
    cap = CameraCapture(a.sn, lambda: RelaySource(cams[a.sn]), ring)
    stop = threading.Event()
    threading.Thread(target=cap.run_forever, args=(stop,), daemon=True).start()

    t0 = time.time()
    while time.time() - t0 < a.wait:
        time.sleep(5)
        s = ring.stats()
        print("[%3.0fs] status=%s quadros=%d keyframes=%d fps~%.1f anel=%.1f MB erro=%s"
              % (time.time() - t0, cap.status, s.frames, s.keyframes, s.fps,
                 s.bytes / 1e6, cap.last_error))

    pressed = time.time()
    s = ring.stats()
    queue = MemoryQueue([ClipJob("smoke-%d" % pressed, a.sn, pressed)])
    job = queue.claim_pending(a.sn)[0]
    ok = process_job(job, ring, queue, LocalDirUploader(a.out), fps=a.fps)
    stop.set()

    print("\n== Medidas ==")
    print("fps medido ........ %.1f (usado no MP4: %.1f)" % (s.fps, a.fps))
    if s.span > 0:
        print("bitrate ........... %.2f Mbps" % (s.bytes * 8 / s.span / 1e6))
    if s.keyframes:
        print("keyframes ......... %d em %.0f s (um a cada ~%.1f s)"
              % (s.keyframes, s.span, s.span / s.keyframes))
    print("clipe ............. %s" % (queue.ready or queue.failed))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

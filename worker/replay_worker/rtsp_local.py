"""
rtsp_local.py — câmeras lidas por RTSP na rede local, em vez do relay da nuvem.

Para câmeras sem relay portável (Yoosee, por exemplo) o worker roda na mesma
rede da câmera. O banco continua com o cadastro normal (SN e credenciais do
formulário, que aqui são ignoradas); o mapa local diz quais SNs usam RTSP.

Arquivo (nunca versionado), apontado por CAMERAS_RTSP:
  {"cameras": [{"sn": "JORTAN-JT8178", "url_env": "REPLAY_RTSP_URL",
                "udp": true, "recodificar": true}]}

A URL com a senha vem da variável de ambiente `url_env`, nunca do arquivo.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from .source import RtspSource


@dataclass(frozen=True)
class CameraRtsp:
    sn: str
    url: str = field(repr=False)
    udp: bool = False
    recodificar: bool = False


def carregar_rtsp(path: str, environ: Mapping[str, str]) -> dict[str, CameraRtsp]:
    """Lê o mapa SN -> câmera RTSP. Erros citam o SN ou a variável, nunca a URL."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("cameras"), list):
        raise ValueError("cameras-rtsp: esperado objeto com a lista 'cameras'")
    mapa: dict[str, CameraRtsp] = {}
    for i, item in enumerate(data["cameras"]):
        if not isinstance(item, dict):
            raise ValueError("cameras-rtsp: item %d não é um objeto" % i)
        sn, var = item.get("sn"), item.get("url_env")
        if not isinstance(sn, str) or not sn.strip():
            raise ValueError("cameras-rtsp: item %d com sn inválido" % i)
        sn = sn.strip()
        if not isinstance(var, str) or not var.strip():
            raise ValueError("cameras-rtsp: câmera %s sem url_env" % sn)
        url = environ.get(var.strip(), "").strip()
        if not url:
            raise ValueError("cameras-rtsp: variável %s não definida (câmera %s)" % (var, sn))
        if not url.startswith("rtsp://"):
            raise ValueError("cameras-rtsp: %s não é uma URL rtsp:// (câmera %s)" % (var, sn))
        if sn in mapa:
            raise ValueError("cameras-rtsp: SN duplicado: %s" % sn)
        mapa[sn] = CameraRtsp(sn, url, udp=item.get("udp") is True,
                              recodificar=item.get("recodificar") is True)
    return mapa


def fonte_para(camera: Any, mapa: Mapping[str, CameraRtsp],
               relay: Callable[[Any], Any]) -> Any:
    """Fonte de vídeo da câmera: RTSP se o SN está no mapa, senão o relay."""
    c = mapa.get(camera.sn)
    if c is None:
        return relay(camera)
    return RtspSource(c.url, recodificar=c.recodificar,
                      transporte="udp" if c.udp else "tcp")

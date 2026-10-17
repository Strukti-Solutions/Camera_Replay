"""config.py — carrega as câmeras de um cameras.json (nunca versionado)."""
import json

from .xm.relay import CameraCreds

_OBRIGATORIOS = ("sn", "authcode", "local_user", "local_pwd")


def load_cameras(path: str) -> dict[str, CameraCreds]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    cams: dict[str, CameraCreds] = {}
    if not isinstance(data, dict) or not isinstance(data.get("cameras"), list):
        raise ValueError("cameras.json: esperado objeto com a lista 'cameras'")
    for i, item in enumerate(data["cameras"]):
        if not isinstance(item, dict):
            raise ValueError("cameras.json: item %d não é um objeto" % i)
        sn = item.get("sn")
        if not isinstance(sn, str) or not sn.strip():
            raise ValueError("cameras.json: item %d com sn inválido" % i)
        faltando = [k for k in _OBRIGATORIOS
                    if not item.get(k) or (isinstance(item[k], str) and not item[k].strip())]
        if faltando:
            raise ValueError("câmera %s sem os campos: %s"
                             % (sn.strip(), ", ".join(faltando)))
        for k in _OBRIGATORIOS:
            if not isinstance(item[k], str):
                raise ValueError("cameras.json: item %d com %s inválido" % (i, k))
        sn = sn.strip()
        if sn in cams:
            raise ValueError("SN duplicado: %s" % sn)
        cams[sn] = CameraCreds(
            sn=sn, authcode=item["authcode"], local_user=item["local_user"],
            local_pwd=item["local_pwd"], name=item.get("name", ""))
    return cams

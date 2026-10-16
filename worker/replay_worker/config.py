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
        faltando = [k for k in _OBRIGATORIOS if not item.get(k)]
        if faltando:
            raise ValueError("câmera %s sem os campos: %s"
                             % (item.get("sn", "?"), ", ".join(faltando)))
        if item["sn"] in cams:
            raise ValueError("SN duplicado: %s" % item["sn"])
        cams[item["sn"]] = CameraCreds(
            sn=item["sn"], authcode=item["authcode"], local_user=item["local_user"],
            local_pwd=item["local_pwd"], name=item.get("name", ""))
    return cams

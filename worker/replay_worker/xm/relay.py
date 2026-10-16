"""
relay.py — conexão remota ao vivo via relay da nuvem do fabricante.

Portado de camera/src/webcam.py (connect_live), sem config.py. Passos: STATUS
(Online + ServerIP) -> CLI_NEED_CON (a câmera disca para o relay) -> handshake
do relay -> login DVRIP local (MD5) -> Claim + Start do OPMonitor.
"""
import base64
import ipaddress
import random
import re
import socket
import string
from dataclasses import dataclass, field

from . import cloud
from .crypto import sofia_hash
from .wire import NetIPReader, netip

STATUS_HOST = "pub-status.secu100.net"
_PARAMS = ('{"Channel":0,"CombinMode":"CONNECT_ALL","StreamType":"Main","TransMode":"TCP"}')


@dataclass(frozen=True)
class CameraCreds:
    sn: str
    authcode: str = field(repr=False)
    local_user: str
    local_pwd: str = field(repr=False)
    name: str = ""


class RelayError(RuntimeError):
    pass


def _rnd(n, alfa):
    return "".join(random.choice(alfa) for _ in range(n))


_HOST_RE = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+secu100\.net", re.IGNORECASE)


def _check_remote(host: str, port: int) -> None:
    """Recusa destinos devolvidos pela nuvem que não sejam do fabricante/públicos."""
    if (not isinstance(host, str) or not isinstance(port, int)
            or isinstance(port, bool) or not 1 <= port <= 65535):
        raise RelayError("endereço remoto inválido")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if not _HOST_RE.fullmatch(host):
            raise RelayError("endereço remoto inválido") from None
        return
    if getattr(ip, "ipv4_mapped", None) is not None:
        ip = ip.ipv4_mapped
    if not ip.is_global:
        raise RelayError("endereço remoto inválido")


def connect_live(cam: CameraCreds, read_timeout: float = 15.0):
    """Abre o stream ao vivo. Devolve (socket, NetIPReader). Levanta RelayError."""
    ac, sn = cam.authcode, cam.sn
    ct = "c_" + _rnd(24, string.ascii_lowercase + string.digits)
    sid = _rnd(32, string.ascii_lowercase + string.digits)

    rq = {"StatusProtocol": {"Header": {"Version": "1.0", "CSeq": "1",
          "MessageType": "MSG_STATUS_LOCALQUERY_REQ"},
          "Body": [{"SerialNumber": sn, "AuthCode": ac}]}}
    d = cloud.jftech_post("https://%s:7605/" % STATUS_HOST, rq, timeout=9)
    row = next((x for x in d["StatusProtocol"]["Body"] if x.get("SerialNumber") == sn), {})
    if row.get("Status") != "Online":
        raise RelayError("câmera offline (ou AuthCode inválido)")
    serverip = row["ServerIP"]

    need = {"AgentProtocol": {"Body": {"Authcode": ac, "ClientToken": ct, "DestPort": "34567",
            "Encrypt": "1", "ProtocolMode": "tcp", "SerialNumber": sn, "ServiceType": "RpsCmd",
            "SessionId": sid, "Step": "0"},
            "Header": {"MessageType": "MSG_CLI_NEED_CON_REQ", "Version": "1.0"}}}
    _check_remote(serverip, 6510)
    rr = cloud.jftech_post("https://%s:6510/" % serverip, need, timeout=9)
    b = rr["AgentProtocol"]["Body"]
    agent, aport = b["AgentServerIp"], int(b["AgentServerPort"])

    _check_remote(agent, aport)
    s = socket.socket()
    try:
        s.settimeout(12)
        s.connect((agent, aport))
        s.sendall(base64.b64encode(("%s:%s:%s:%s" % (ac, ct, sn, sid)).encode()) + b"XXEE")
        s.recv(2048)
        rd = NetIPReader(s)

        # pré-login Claim (SID 0x1869f, canal 99) -> 1414
        s.sendall(netip('{"Name":"OPMonitor","OPMonitor":{"Action":"Claim","Parameter":%s},'
                        '"DHParameter":{"RandomStrA":"%s"},"SessionID":"0x000001869f"}'
                        % (_PARAMS, _rnd(4, string.ascii_uppercase + string.digits)),
                        sid=0x1869F, msgid=1413, seq=1, chn=99))
        rd.wait({1414})

        # login local MD5 -> 1001
        s.sendall(netip('{"EncryptType":"MD5","LoginType":"DVRIP-Web","UserName":"%s",'
                        '"PassWord":"%s","User-Agent":"replay-worker"}'
                        % (cam.local_user, sofia_hash(cam.local_pwd)),
                        sid=0, msgid=1000, seq=2))
        _, t = rd.wait({1001})
        m = re.search(r'"SessionID"\s*:\s*"?(0x[0-9a-fA-F]+)"?', t or "")
        ret = re.search(r'"Ret"\s*:\s*(\d+)', t or "")
        if not m or (ret and ret.group(1) != "100"):
            raise RelayError("login falhou (Ret=%s)" % (ret and ret.group(1)))
        sess = int(m.group(1), 16)

        s.sendall(netip('{"Name":"OPMonitor","OPMonitor":{"Action":"Claim","Parameter":%s},'
                        '"SessionID":"%s"}' % (_PARAMS, hex(sess)),
                        sid=sess, msgid=1413, seq=3))
        rd.wait({1414})
        s.sendall(netip('{"Name":"OPMonitor","OPMonitor":{"Action":"Start","Parameter":%s},'
                        '"SessionID":"%s"}' % (_PARAMS, hex(sess)),
                        sid=sess, msgid=1410, seq=4))
        s.settimeout(read_timeout)   # fluxo mudo por muito tempo = conexão morta
        return s, rd
    except Exception:
        s.close()
        raise

"""
checar.py — diagnóstico do teste real, sem imprimir nenhum segredo.

Confere o .env, o banco, a câmera cadastrada (status e últimos clipes), o R2,
o ffmpeg, o mapa RTSP e se a câmera responde na rede.

Uso: py -m replay_worker.checar [--env .env] [--sn JORTAN-JT8178] [--ip 192.168.0.108]
"""
from __future__ import annotations

import argparse
import re
import shutil
import socket
import sys
from urllib.parse import unquote, urlsplit

_NOMES = ("DATABASE_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
          "R2_BUCKET", "CAMERA_CRED_KEY")


def ler_env(caminho: str) -> dict[str, str]:
    env: dict[str, str] = {}
    with open(caminho, encoding="utf-8-sig") as f:
        for linha in f:
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*)$", linha)
            if m:
                env[m.group(1)] = m.group(2).strip()
    return env


def mascarar(texto: str, segredos) -> str:
    """Tira de uma mensagem de erro os segredos dados e qualquer senha em URL."""
    for s in sorted((s for s in segredos if s and len(s) >= 3), key=len, reverse=True):
        texto = texto.replace(s, "***")
    return re.sub(r"(://[^:/@\s]+:)[^@\s]*@", r"\1***@", texto)


def _segredos_da_url(url: str) -> list[str]:
    try:
        u = urlsplit(url)
        return [x for x in (u.password, unquote(u.password or "")) if x]
    except ValueError:
        return []


def _ok(rotulo: str, ok: bool, detalhe: str = "") -> bool:
    print("%s %-34s %s" % ("[ok]  " if ok else "[FALHA]", rotulo, detalhe))
    return ok


def checar_url_banco(url: str) -> str | None:
    """Problemas de forma na DATABASE_URL, sem conectar. None se a forma está boa."""
    if not url.startswith(("postgres://", "postgresql://")):
        return "não começa com postgresql://"
    if "[" in url or "]" in url:
        return "tem colchetes [ ]: tire os colchetes em volta da senha"
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return "URL mal formada"
    if host.startswith("db.") and host.endswith(".supabase.co"):
        return "host direto do Supabase (só IPv6): use a URI do Session pooler"
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Diagnóstico do teste real (não imprime segredos).")
    ap.add_argument("--env", default=".env")
    ap.add_argument("--sn", default="JORTAN-JT8178")
    ap.add_argument("--ip", default="192.168.0.108")
    a = ap.parse_args(argv)

    try:
        env = ler_env(a.env)
    except OSError:
        _ok("arquivo .env", False, "não encontrei %s" % a.env)
        return 1
    faltando = [n for n in _NOMES if not env.get(n)]
    _ok("variáveis do .env", not faltando, ("faltam: " + ", ".join(faltando)) if faltando else "")
    com_aspas = [n for n in _NOMES if env.get(n, "")[:1] in ("'", '"')]
    if com_aspas:
        _ok("valores sem aspas", False, "tire as aspas de: " + ", ".join(com_aspas))

    from .creds import ler_chave
    chave = None
    if env.get("CAMERA_CRED_KEY"):
        try:
            chave = ler_chave(env["CAMERA_CRED_KEY"])
            _ok("CAMERA_CRED_KEY (formato)", True)
        except ValueError:
            _ok("CAMERA_CRED_KEY (formato)", False, "precisa ser base64 de 32 bytes")

    url = env.get("DATABASE_URL", "")
    if url:
        problema = checar_url_banco(url)
        _ok("DATABASE_URL (formato)", problema is None, problema or "")
        if problema is None:
            _checar_banco(url, chave, a.sn)

    if all(env.get(n) for n in _NOMES[1:5]):
        _checar_r2(env)

    _ok("ffmpeg no PATH", shutil.which("ffmpeg") is not None,
        "" if shutil.which("ffmpeg") else "abra um terminal novo ou rode pelo teste-real-worker.ps1")
    try:
        socket.create_connection((a.ip, 554), timeout=3).close()
        _ok("câmera responde (RTSP 554)", True, a.ip)
    except OSError as e:
        _ok("câmera responde (RTSP 554)", False, "%s: %s" % (a.ip, type(e).__name__))
    return 0


def _checar_banco(url: str, chave, sn: str) -> None:
    import psycopg
    try:
        conn = psycopg.connect(url, connect_timeout=10)
    except Exception as e:
        msg = mascarar(str(e).splitlines()[0] if str(e) else type(e).__name__, _segredos_da_url(url))
        if "password authentication failed" in msg:
            msg = "senha errada na DATABASE_URL (copie a da Vercel, ambiente Production)"
        _ok("banco conecta", False, msg[:200])
        return
    with conn:
        _ok("banco conecta", True)
        linhas = conn.execute(
            "select c.id, c.status, c.visto_em, c.credenciais, exists(select 1 from botoes b "
            "where b.camera_id = c.id and b.revogado_em is null) from cameras c where c.sn = %s",
            (sn,)).fetchall()
        if not _ok("câmera %s cadastrada" % sn, bool(linhas), "" if linhas else "cadastre no /admin"):
            return
        cam, status, visto, cred, tem_botao = linhas[0]
        _ok("botão ativo na câmera", tem_botao, "" if tem_botao else "crie um botão no /admin")
        _ok("status da câmera no banco", status == "online", "%s, visto em %s" % (status, visto))
        if chave is not None:
            from .creds import decifrar_credenciais
            try:
                decifrar_credenciais(cred, chave, sn)
                decifra = True
            except ValueError:
                decifra = False
            print("[info]  credencial decifra com a chave    %s" % (
                "sim" if decifra else "não (ok no modo RTSP; o relay exigiria a chave da Vercel)"))
        clipes = conn.execute(
            "select status, recebido_em, motivo, duracao from clipes where camera_id = %s "
            "order by recebido_em desc limit 5", (cam,)).fetchall()
        print("[info]  últimos clipes: %s" % ("nenhum (nenhum aperto chegou)" if not clipes else ""))
        for st, rec, motivo, dur in clipes:
            print("          %s  %-10s %s" % (rec, st, motivo or ("%.1f s" % dur if dur else "")))


def _checar_r2(env: dict[str, str]) -> None:
    from .r2 import R2Uploader
    try:
        u = R2Uploader(env["R2_ACCOUNT_ID"], env["R2_ACCESS_KEY_ID"],
                       env["R2_SECRET_ACCESS_KEY"], env["R2_BUCKET"])
        chave = "clipes/teste-conexao/checar.txt"
        u.put(chave, b"ok")
        u.delete(chave)
        _ok("R2 escreve e apaga", True)
    except Exception as e:
        _ok("R2 escreve e apaga", False, type(e).__name__)


if __name__ == "__main__":
    sys.exit(main())

"""Run the packaged app and its deployment smoke through disposable loopback TLS."""
import base64
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "deploy"))
from bundle import BASE, digest, pack
from receiver import current, health, publish, read_release


def run(archive, commit, temp):
    nginx = os.environ.get("NGINX_BIN") or shutil.which("nginx") or "/usr/sbin/nginx"
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    origin = f"https://127.0.0.1:{port}"
    bad_commit = ("0" if commit != "0" * 40 else "1") * 40
    root = temp / "family-calendar"
    (root / "releases").mkdir(parents=True)
    cert, key = temp / "cert.pem", temp / "key.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1",
                    "-keyout", key, "-out", cert], check=True, capture_output=True)
    os.environ["SSL_CERT_FILE"] = str(cert)
    public = subprocess.check_output(["openssl", "pkey", "-in", key, "-pubout", "-outform", "DER"])
    spki = base64.b64encode(hashlib.sha256(public).digest()).decode()
    snippet = (REPO / "deploy/calendar.nginx.conf").read_text().replace("/var/www/family-calendar", str(root))
    (temp / "calendar.conf").write_text(snippet)
    conf = temp / "nginx.conf"
    conf.write_text("""
daemon off;
master_process off;
pid nginx.pid;
error_log stderr warn;
events {}
http {
    access_log off;
    client_body_temp_path body;
    proxy_temp_path proxy;
    fastcgi_temp_path fastcgi;
    uwsgi_temp_path uwsgi;
    scgi_temp_path scgi;
    types { text/html html; text/css css; application/javascript js; application/json json; }
    server {
        listen 127.0.0.1:PORT ssl;
        ssl_certificate cert.pem;
        ssl_certificate_key key.pem;
        add_header X-Content-Type-Options nosniff always;
        include calendar.conf;
        if ($arg_revision = BAD_COMMIT) { return 200 'stale response'; }
        location / { return 404; }
        location = /apps/workout/ { default_type text/html; return 200 '<title>Sibling fixture</title>'; }
        location = /api/v1/auth/session {
            if ($cookie_fixture != household) { return 401; }
            default_type application/json;
            return 200 '{"principalId":"f2c91709-1454-46af-bea1-e738ef7e5175","csrfToken":"fixture-token","expiresAt":4102444800}';
        }
        location ~ ^/api/v1/(people|spaces)$ {
            default_type application/json;
            return 200 '{"items":[],"hasMore":false}';
        }
        location = /api/v1/auth/logout {
            if ($request_method != POST) { return 405; }
            if ($cookie_fixture != household) { return 401; }
            if ($http_origin != 'ORIGIN') { return 403; }
            if ($http_x_csrf_token != fixture-token) { return 403; }
            add_header Set-Cookie 'fixture=; Max-Age=0; Path=/api/v1/; Secure; HttpOnly; SameSite=Strict';
            return 204;
        }
    }
}
""".replace("PORT", str(port)).replace("ORIGIN", origin).replace("BAD_COMMIT", bad_commit))
    (temp / "logs").mkdir()
    command = [nginx, "-p", str(temp) + "/", "-c", str(conf), "-e", "stderr"]
    subprocess.run([*command, "-t"], check=True)
    server = subprocess.Popen(command)
    try:
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=.2):
                    break
            except OSError:
                if server.poll() is not None:
                    raise RuntimeError("fixture Nginx exited")
                time.sleep(.05)
        def probe(files, sha):
            health(files, sha, origin + BASE)
        def send(path, sha):
            with path.open("rb") as stream:
                publish(root, f"publish {sha} {digest(path.read_bytes())}", stream, probe)
        send(archive, commit)
        invalid_health = temp / "stale.zip"
        pack(REPO / "dist", invalid_health, bad_commit)
        try:
            send(invalid_health, bad_commit)
        except ValueError as error:
            if "HTTP content mismatch" not in str(error):
                raise
        else:
            raise AssertionError("stale HTTP 200 passed deployment")
        if current(root) != commit:
            raise AssertionError("previous release was not restored")
        probe(read_release(root, commit), commit)
        subprocess.run([os.environ.get("NODE_BIN", "node"), "tests/browser-smoke.mjs",
                        str(port), spki, commit], cwd=REPO, check=True, timeout=90)
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="calendar-nginx-") as directory:
        run(Path(sys.argv[1]), sys.argv[2], Path(directory))

"""Root-installed forced SSH command. Runs as the unprivileged Calendar user."""
import contextlib
import fcntl
import io
import json
import os
import re
import shutil
import signal
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

from bundle import BASE, LIMIT, ORIGIN, SHA, VITE, digest, require, unpack, validate


ROOT = Path("/var/www/family-calendar")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def health(files, commit, base=ORIGIN + BASE):
    client = urllib.request.build_opener(NoRedirect())
    public = {"": files["index.html"], **files}
    del public[VITE]
    query = f"?revision={commit}&probe={time.time_ns()}"
    for name, expected in public.items():
        request = urllib.request.Request(base + name + query,
                                         headers={"Cache-Control": "no-cache", "Accept-Encoding": "identity"})
        with client.open(request, timeout=8) as response:
            require(response.status == 200 and response.read(len(expected) + 1) == expected,
                    f"HTTP content mismatch at {BASE}{name}")
            mime = response.headers.get_content_type()
            types = {".js": {"application/javascript", "text/javascript"}, ".css": {"text/css"},
                     ".webmanifest": {"application/manifest+json"}, ".html": {"text/html"},
                     ".json": {"application/json"}}
            allowed = types.get(Path(name or "index.html").suffix)
            require(not allowed or mime in allowed, f"incorrect MIME type at {BASE}{name}")
            if name == "sw.js":
                scope = response.headers.get("Service-Worker-Allowed", "./")
                require(urljoin(base, scope) == base, "incorrect Calendar worker scope limit")


def public_smoke(files, commit):
    for attempt in range(3):
        try:
            health(files, commit)
            return
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(2)


def current(root):
    pointer = root / "current"
    if not pointer.is_symlink():
        require(not pointer.exists(), "unexpected current path")
        return None
    match = re.fullmatch(r"releases/([0-9a-f]{40})", os.readlink(pointer))
    require(match and pointer.is_dir(), "unexpected current target")
    return match[1]


def switch(root, commit):
    if commit is None:
        (root / "current").unlink(missing_ok=True)
        return
    require(SHA.fullmatch(commit) and (root / "releases" / commit).is_dir(), "release unavailable")
    temp = root / ".next"
    temp.unlink(missing_ok=True)
    temp.symlink_to("releases/" + commit)
    temp.replace(root / "current")


def recover(root):
    pending = root / ".pending"
    if pending.exists():
        old, new = json.loads(pending.read_bytes())
        active = current(root)
        require(active in (old, new), "current changed outside the release lock")
        if active == new:
            switch(root, old)
        pending.unlink()


@contextlib.contextmanager
def locked(root):
    with (root / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        recover(root)
        yield


def read_release(root, commit):
    require(SHA.fullmatch(commit), "invalid release ID")
    directory = root / "releases" / commit
    require(directory.is_dir() and not directory.is_symlink(), "missing release")
    files = {}
    for path in directory.rglob("*"):
        require(not path.is_symlink(), "symlink in release")
        if path.is_file():
            files[path.relative_to(directory).as_posix()] = path.read_bytes()
    validate(files, commit)
    return files


def activate(root, files, commit, probe):
    old = current(root)
    if old == commit:
        probe(files, commit)
        return old
    pending = root / ".pending"
    temp = root / ".transaction"
    temp.write_text(json.dumps([old, commit]))
    temp.replace(pending)
    try:
        switch(root, commit)
        probe(files, commit)
        pending.unlink()
    except BaseException:
        recover(root)
        raise
    return old


def prune(root, active, previous):
    releases = root / "releases"
    candidates = [p for p in releases.iterdir() if SHA.fullmatch(p.name) and not p.is_symlink()
                  and p.is_dir() and (p / "release.json").is_file()]
    keep = {active, previous} - {None}
    for path in sorted(candidates, key=lambda p: p.stat().st_mtime_ns, reverse=True):
        if len(keep) < 5:
            keep.add(path.name)
        if path.name not in keep:
            shutil.rmtree(path)


def publish(root, command, stream, probe=public_smoke):
    match = re.fullmatch(r"publish ([0-9a-f]{40}) ([0-9a-f]{64})", command)
    require(match, "expected publish COMMIT SHA256")
    commit, checksum = match.groups()
    with locked(root):
        data = stream.read(LIMIT + 1)
        require(len(data) <= LIMIT and digest(data) == checksum, "archive size or SHA-256 mismatch")
        files = unpack(io.BytesIO(data), commit)
        destination = root / "releases" / commit
        created = not destination.exists()
        if created:
            # Preserve the free-space reserve used by the sibling static deployer.
            require(shutil.disk_usage(root).free >= 3 * 1024**3 + len(data), "low Calendar disk space")
            with tempfile.TemporaryDirectory(dir=root) as scratch:
                stage = Path(scratch) / "release"
                for name, content in files.items():
                    path = stage / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
                stage.rename(destination)
        try:
            saved = read_release(root, commit)
            require(saved == files, "existing release differs for this commit")
            old = activate(root, saved, commit, probe)
        except BaseException:
            if created and current(root) != commit:
                shutil.rmtree(destination)
            raise
        # A rerun of the current commit must preserve its actual predecessor.
        if old != commit:
            prune(root, commit, old)
        print(f"Verified Calendar commit {commit} (previous {old or 'none'})")


def main(args):
    os.umask(0o022)
    if args == ["receive"]:
        # Finish the health/rollback transaction even if the SSH client disconnects.
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        publish(ROOT, os.environ.get("SSH_ORIGINAL_COMMAND", ""), sys.stdin.buffer)
    elif args == ["recover"]:
        with locked(ROOT):
            print(f"Current Calendar release: {current(ROOT) or 'none'}")
    elif len(args) == 3 and args[0] == "rollback":
        _, expected, target = args
        with locked(ROOT):
            require(current(ROOT) == expected, "active commit changed, inspect current")
            activate(ROOT, read_release(ROOT, target), target, public_smoke)
            print(f"Verified rollback to {target}")
    else:
        raise ValueError("expected receive, recover or rollback EXPECTED_CURRENT TARGET")


if __name__ == "__main__":
    main(sys.argv[1:])

"""Package and validate Calendar's static release. Requires Python 3.10+."""
import hashlib
import json
import re
import stat
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin


BASE = "/apps/calendar/"
ORIGIN = "https://www.nickbuzzerio.com"
VITE = ".vite/manifest.json"
SHELL = {"index.html", "sw.js", "register-offline.js", "calendar.webmanifest", VITE}
ASSET = re.compile(r"assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+")
SHA = re.compile(r"[0-9a-f]{40}")
LIMIT = 32 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inventory(manifest):
    entry = manifest["index.html"]
    require(entry["isEntry"] and entry["file"].endswith(".js") and entry["css"],
            "missing Calendar JavaScript or stylesheet entry")
    assets = set()
    for item in manifest.values():
        for ref in item.get("imports", []) + item.get("dynamicImports", []):
            require(ref in manifest, f"unresolved Vite import {ref}")
        for path in [item["file"], *item.get("css", []), *item.get("assets", [])]:
            require(ASSET.fullmatch(path), f"unexpected Vite asset {path}")
            assets.add(path)
    return SHELL | assets


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        require(tag != "base", "HTML base override")
        for key in ("href", "src"):
            if key in attrs:
                self.refs.add(attrs[key])


def validate(files, commit):
    require(SHA.fullmatch(commit), "invalid commit")
    manifest = json.loads(files[VITE])
    paths = inventory(manifest)
    require(set(files) == paths | {"release.json"}, "incomplete or unexpected release inventory")
    require(all(files.values()), "empty release file")
    marker = {"app": "family-calendar", "base": BASE, "commit": commit,
              "files": {p: digest(files[p]) for p in paths}}
    require(json.loads(files["release.json"]) == marker, "release identity or checksum mismatch")

    links = PageLinks()
    links.feed(files["index.html"].decode())
    resolved = {urljoin(ORIGIN + BASE, ref) for ref in links.refs}
    urls = {ORIGIN + BASE + p for p in paths}
    entry = manifest["index.html"]
    required = {entry["file"], *entry["css"], "calendar.webmanifest", "register-offline.js"}
    require({ORIGIN + BASE + p for p in required} <= resolved <= urls,
            "HTML references do not resolve to Calendar release files")
    for name in paths:
        if name.endswith(".css"):
            for ref in re.findall(r"""url\(\s*['"]?([^)'"]+)['"]?\s*\)""", files[name].decode(), re.I):
                ref = ref.strip()
                if not ref.startswith(("data:", "#")):
                    require(urljoin(ORIGIN + BASE + name, ref) in urls,
                            f"unresolved stylesheet reference in {name}")
    webmanifest = json.loads(files["calendar.webmanifest"])
    for key in ("scope", "start_url"):
        require(urljoin(ORIGIN + BASE, webmanifest[key]) == ORIGIN + BASE, f"incorrect manifest {key}")


def pack(directory, archive, commit):
    paths = inventory(json.loads((directory / VITE).read_bytes()))
    # This project's pinned Vite wrapper retains old hashed assets on rebuilds.
    # Refuse any other unaccounted output so new static files cannot be dropped.
    for path in directory.rglob("*"):
        name = path.relative_to(directory).as_posix()
        require(not path.is_symlink(), "symlink in build output")
        if not path.is_dir():
            require(name in paths or ASSET.fullmatch(name), f"unaccounted build file {name}")
    files = {}
    for name in sorted(paths):
        path = directory / name
        require(path.resolve() == directory.resolve() / name and path.is_file(), f"invalid file {name}")
        files[name] = path.read_bytes()
    marker = {"app": "family-calendar", "base": BASE, "commit": commit,
              "files": {name: digest(data) for name, data in files.items()}}
    files["release.json"] = json.dumps(marker, sort_keys=True).encode() + b"\n"
    validate(files, commit)
    with zipfile.ZipFile(archive, "w") as output:
        for name, data in files.items():
            output.writestr(zipfile.ZipInfo(name), data)
    require(archive.stat().st_size <= LIMIT, "Calendar package exceeds size limit")


def unpack(stream, commit):
    with zipfile.ZipFile(stream) as archive:
        entries = archive.infolist()
        require(len(entries) <= 512 and sum(info.file_size for info in entries) <= LIMIT,
                "oversized release")
        files = {}
        for info in entries:
            name = info.filename
            require((name in SHELL | {"release.json"} or ASSET.fullmatch(name))
                    and name not in files and info.compress_type == zipfile.ZIP_STORED
                    and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG),
                    "unexpected ZIP entry")
            files[name] = archive.read(info)
    validate(files, commit)
    return files


if __name__ == "__main__":
    _, directory, archive, commit = sys.argv
    pack(Path(directory), Path(archive), commit)
    with open(archive, "rb") as stream:
        unpack(stream, commit)
    print(digest(Path(archive).read_bytes()))

"""Exercise the real Calendar packer and Linux receiver in disposable directories."""
import contextlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "deploy"))
from bundle import digest, pack
from receiver import activate, current, locked, publish, read_release, switch


class Releases(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        (self.root / "releases").mkdir()
        self.first = "1" * 40
        self.next = "2" * 40

    def package(self, sha):
        path = self.root / "package.zip"
        pack(REPO / "dist", path, sha)
        return path.read_bytes()

    def send(self, sha, data=None, checksum=None, probe=None):
        data = self.package(sha) if data is None else data
        def check(files, commit):
            self.assertEqual(current(self.root), commit)
            self.assertEqual(files["index.html"], (self.root / "current/index.html").read_bytes())
        with contextlib.redirect_stdout(io.StringIO()):
            publish(self.root, f"publish {sha} {checksum or digest(data)}", io.BytesIO(data), probe or check)

    def test_incomplete_corrupt_and_unexpected_uploads_preserve_previous(self):
        self.send(self.first)
        valid = self.package(self.next)
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.send(self.next, valid[:-1], digest(valid))
        for wrong in ("missing", "modified", "extra", "path", "symlink", "different commit"):
            changed = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(valid)) as src, zipfile.ZipFile(changed, "w") as dst:
                for name in src.namelist():
                    if wrong == "missing" and name == "sw.js":
                        continue
                    info = zipfile.ZipInfo(name)
                    if wrong == "symlink" and name == "sw.js":
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    dst.writestr(info, b"wrong" if wrong == "modified" and name == "index.html" else src.read(name))
                if wrong == "extra":
                    dst.writestr("node_modules/payload.js", b"x")
                if wrong == "path":
                    dst.writestr("../other-app", b"x")
            with self.subTest(wrong=wrong), self.assertRaises((ValueError, KeyError)):
                self.send(self.first if wrong == "different commit" else self.next, changed.getvalue())
            self.assertEqual(read_release(self.root, current(self.root))["sw.js"],
                             (REPO / "dist/sw.js").read_bytes())
            self.assertEqual(current(self.root), self.first)
            self.assertFalse((self.root / "releases" / self.next).exists())

    def test_health_failure_rolls_back_and_fails_first_and_subsequent_publish(self):
        def fail(_files, sha):
            self.assertEqual(current(self.root), sha)
            raise OSError("HTTPS failed")
        for prior in (None, self.first):
            if prior:
                self.send(prior)
            with self.assertRaisesRegex(OSError, "HTTPS failed"):
                self.send(self.next, probe=fail)
            self.assertEqual(current(self.root), prior)
            self.assertFalse((self.root / ".pending").exists())

    def test_retries_rollback_and_interrupted_switch(self):
        self.send(self.first)
        self.send(self.next)
        self.send(self.next)
        for target in (self.first, self.next):
            with locked(self.root):
                activate(self.root, read_release(self.root, target), target, lambda *_: None)
            self.assertEqual(current(self.root), target)
        # Simulate a process killed after rename but before a successful probe.
        (self.root / ".pending").write_text(json.dumps([self.first, self.next]))
        with locked(self.root):
            self.assertEqual(current(self.root), self.first)
            with self.assertRaises(BlockingIOError):
                self.send(self.next)

    def test_retention_keeps_previous_and_unrelated_paths(self):
        releases = self.root / "releases"
        (releases / "untouched").mkdir()
        other = self.root / "other"
        other.mkdir()
        (releases / ("f" * 40)).symlink_to(other)
        for i in range(1, 7):
            self.send(str(i) * 40)
        with locked(self.root):
            switch(self.root, "2" * 40)
        self.send("7" * 40)
        self.send("7" * 40)
        self.assertEqual(len([p for p in releases.iterdir() if (p / "release.json").is_file()]), 5)
        self.assertTrue((releases / ("2" * 40) / "sw.js").is_file())
        self.assertTrue((releases / "untouched").exists() and other.exists())

    def test_ssh_sender_fails_closed(self):
        env = {"PATH": str(self.root) + ":" + os.environ["PATH"]}
        script = ["bash", "deploy/publish.sh", str(self.root / "package.zip")]
        def run():
            return subprocess.run(script, env=env, cwd=REPO, text=True, capture_output=True)
        result = run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing calendar-production secret CALENDAR_DEPLOY_KEY", result.stderr)
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(self.root / "key")], check=True)
        key = (self.root / "key").read_text()
        data = self.package(self.first)
        env.update(CALENDAR_DEPLOY_KEY=key, CALENDAR_SSH_HOST="test.invalid", CALENDAR_SSH_PORT="22",
                   CALENDAR_SSH_HOST_KEY=" ".join((self.root / "key.pub").read_text().split()[:2]),
                   ARTIFACT_SHA256=digest(data), GITHUB_SHA=self.first, GITHUB_REPOSITORY="local/fixture")
        gh, ssh = self.root / "gh", self.root / "ssh"
        gh.write_text('#!/bin/sh\necho "$FAKE_HEAD"\n')
        ssh.write_text('#!/bin/sh\ncat >/dev/null\nexit 47\n')
        gh.chmod(0o755)
        ssh.chmod(0o755)
        env["FAKE_HEAD"] = self.next
        result = run()
        self.assertIn("Superseded commit", result.stderr)
        env["FAKE_HEAD"] = self.first
        result = run()
        self.assertEqual(result.returncode, 47, result.stderr)
        self.assertNotIn(key, result.stdout + result.stderr)
        env["ARTIFACT_SHA256"] = "0" * 64
        self.assertNotIn(run().returncode, (0, 47))


if __name__ == "__main__":
    unittest.main(verbosity=2)

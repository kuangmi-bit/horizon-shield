"""The packaged agreement verifier is the repository's file, unchanged but for one import line."""
import hashlib
import json
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.join(os.path.dirname(HERE), "src", "nenrin_verify")
PINS = json.load(open(os.path.join(PKG, "VENDORED.json")))


@pytest.mark.parametrize("name", sorted(PINS))
def test_vendored_file_matches_its_pin(name):
    data = open(os.path.join(PKG, name), "rb").read()
    assert hashlib.sha256(data).hexdigest() == PINS[name]["vendored_sha256"]


@pytest.mark.skipif(not os.path.isdir(os.path.join(os.path.dirname(HERE), "..", "agreement-v0")), reason="outside the repository")
def test_vendored_files_are_what_the_sources_build():
    p = subprocess.run([sys.executable, os.path.join(os.path.dirname(HERE), "tools", "vendor.py"), "--check"], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr

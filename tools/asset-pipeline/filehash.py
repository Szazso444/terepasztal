"""SHA-256 of a pipeline input that is the same on every checkout.

A Windows checkout with `core.autocrlf` has CRLF line endings where the cloud has LF, so a raw hash
of a recipe, a project file or this code differs between the author's PC and the cloud. Text files
are therefore hashed with CRLF read as LF; binaries (.png, .blend, .glb) are hashed as they are.
Every lock, receipt and manifest hash of the hand-built method goes through `digest`.
"""
import hashlib
from pathlib import Path

TEXT = {'.py', '.json', '.md', '.txt', '.mjs', '.toml', '.csv'}


def digest(path):
    path = Path(path)
    data = path.read_bytes()
    if path.suffix.lower() in TEXT:
        data = data.replace(b'\r\n', b'\n')
    return hashlib.sha256(data).hexdigest()

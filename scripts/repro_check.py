"""Lightweight reproducibility checks for local development.

This script does not mutate data. It verifies that local setup is ready
to run the app and tests consistently.
"""

from __future__ import annotations

import json
import platform
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _ok(msg: str) -> None:
    print(f"[OK] {msg}")


def _warn(msg: str) -> None:
    print(f"[WARN] {msg}")


def _fail(msg: str) -> None:
    print(f"[FAIL] {msg}")


def main() -> int:
    rc = 0
    py = sys.version_info
    if py < (3, 11):
        _fail(f"Python {py.major}.{py.minor} is too old; require >= 3.11")
        rc = 1
    else:
        _ok(f"Python version {py.major}.{py.minor}.{py.micro}")

    if platform.system().lower() == "windows":
        _warn("Windows detected; project is primarily tested on macOS/Linux.")

    required_files = [
        ROOT / "pyproject.toml",
        ROOT / "README.md",
        ROOT / ".env.example",
        ROOT / "web" / "package.json",
        ROOT / "web" / "package-lock.json",
    ]
    for p in required_files:
        if p.is_file():
            _ok(f"Found {p.relative_to(ROOT)}")
        else:
            _fail(f"Missing {p.relative_to(ROOT)}")
            rc = 1

    env_path = ROOT / ".env"
    if env_path.is_file():
        _ok("Found .env")
    else:
        _warn("No .env found. Copy from .env.example before running API with LLM/web features.")

    data_dir = ROOT / "data"
    for rel in ["chroma", "traces", "outcomes", "profile"]:
        p = data_dir / rel
        if p.exists():
            _ok(f"Data path exists: data/{rel}")
        else:
            _warn(f"Data path missing: data/{rel} (will be created at runtime)")

    web_pkg = ROOT / "web" / "package.json"
    try:
        pkg = json.loads(web_pkg.read_text(encoding="utf-8"))
        scripts = pkg.get("scripts", {})
        for key in ["dev", "build", "test"]:
            if key in scripts:
                _ok(f"web script: {key}")
            else:
                _warn(f"web script missing: {key}")
    except Exception as exc:
        _fail(f"Unable to parse web/package.json: {exc}")
        rc = 1

    if rc == 0:
        _ok("Reproducibility checks passed.")
    else:
        _fail("Reproducibility checks found issues.")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

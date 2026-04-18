#!/usr/bin/env python3
"""One-shot Tavily check. Loads `.env` from the repository root (not only cwd).

Usage (from repo root):
  cp .env.example .env
  # edit .env and set TAVILY_API_KEY
  pip install tavily-python python-dotenv pydantic pydantic-settings
  # or full project: pip install -e ".[dev]"
  python scripts/smoke_tavily.py

Imports only `tavily_client` + `config` (not `retrieval/__init__.py`), so Chroma/LlamaIndex are not required for this script.
The repo root is added to sys.path when `pip install -e .` was skipped.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
# Allow `python scripts/smoke_tavily.py` without `pip install -e .`
_root_str = str(_ROOT)
if _root_str not in sys.path:
    sys.path.insert(0, _root_str)


def main() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError as e:
        raise SystemExit(
            "Install dev deps: pip install -e \".[dev]\"  (needs python-dotenv)"
        ) from e

    load_dotenv(_ROOT / ".env")

    try:
        from foresight_x.config import load_settings
        from foresight_x.retrieval.tavily_client import build_tavily_gateway
    except ModuleNotFoundError as e:
        missing = getattr(e, "name", "") or ""
        if missing == "tavily":
            raise SystemExit(
                "Missing Tavily package for THIS interpreter. Run (use the same `python` you use for this script):\n"
                "  python -m pip install tavily-python\n"
                "Or:\n"
                "  python -m pip install -e \".[dev]\"\n"
                "Check: python -c \"import tavily\""
            ) from e
        raise

    s = load_settings()
    if not (s.tavily_api_key or "").strip():
        raise SystemExit(
            f"Missing TAVILY_API_KEY. Copy {_ROOT / '.env.example'} to {_ROOT / '.env'} "
            "and set your key."
        )

    gw = build_tavily_gateway(s)
    facts = gw.search_as_facts("microservices scaling best practices")
    print(facts[0] if facts else "(no results)")


if __name__ == "__main__":
    main()

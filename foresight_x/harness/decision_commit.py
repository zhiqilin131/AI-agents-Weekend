"""Persist user \"adopt\" choice (which option they commit to) before outcome."""

from __future__ import annotations

from pathlib import Path

from foresight_x.config import Settings, load_settings
from foresight_x.schemas import DecisionCommit


def save_commit(commit: DecisionCommit, *, settings: Settings | None = None, commits_dir: Path | None = None) -> Path:
    s = settings or load_settings()
    root = commits_dir if commits_dir is not None else s.commits_dir
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{commit.decision_id}.json"
    path.write_text(commit.model_dump_json(indent=2), encoding="utf-8")
    return path


def load_commit(decision_id: str, *, settings: Settings | None = None, commits_dir: Path | None = None) -> DecisionCommit | None:
    s = settings or load_settings()
    root = commits_dir if commits_dir is not None else s.commits_dir
    path = root / f"{decision_id}.json"
    if not path.is_file():
        return None
    try:
        return DecisionCommit.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def delete_commit(decision_id: str, *, settings: Settings | None = None, commits_dir: Path | None = None) -> bool:
    s = settings or load_settings()
    root = commits_dir if commits_dir is not None else s.commits_dir
    path = root / f"{decision_id}.json"
    if path.is_file():
        path.unlink()
        return True
    return False

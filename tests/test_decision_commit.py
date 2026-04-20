"""Decision commit persistence (no API)."""

from __future__ import annotations

from pathlib import Path

import pytest

from foresight_x.config import Settings
from foresight_x.harness.decision_commit import delete_commit, load_commit, save_commit
from foresight_x.schemas import DecisionCommit


def test_save_load_delete_commit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    s = Settings()
    c = DecisionCommit(
        decision_id="cid-1",
        chosen_option_id="opt-x",
        matches_recommendation=True,
        committed_at="2026-03-01T00:00:00Z",
    )
    p = save_commit(c, settings=s)
    assert p.is_file()
    got = load_commit("cid-1", settings=s)
    assert got is not None
    assert got.chosen_option_id == "opt-x"
    assert delete_commit("cid-1", settings=s) is True
    assert load_commit("cid-1", settings=s) is None

"""Profile merge and persistence."""

from __future__ import annotations

from pathlib import Path

import pytest

from foresight_x.config import Settings
from foresight_x.profile.merge import (
    append_clarification_to_profile,
    append_inferred_priority_line,
    merge_profile_into_user_state,
)
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import Reversibility, TimePressure, UserProfile, UserState


def test_append_clarification_dedupes() -> None:
    p = UserProfile(priorities=["existing"])
    u = append_clarification_to_profile(p, {"budget_sensitivity": "Tight budget"})
    assert "existing" in u.priorities
    assert any("budget sensitivity" in x.lower() for x in u.priorities)
    u2 = append_clarification_to_profile(u, {"budget_sensitivity": "Tight budget"})
    assert u2.priorities == u.priorities


def test_append_inferred_dedupes() -> None:
    p = UserProfile(user_priorities=["mine"], inferred_priorities=[])
    q = append_inferred_priority_line(p, "likes structure")
    assert "likes structure" in q.inferred_priorities
    q2 = append_inferred_priority_line(q, "likes structure")
    assert q2.inferred_priorities.count("likes structure") == 1


def test_merge_priorities_prepend_goals() -> None:
    base = UserState(
        raw_input="x",
        goals=["situational goal"],
        time_pressure=TimePressure.LOW,
        stress_level=3,
        workload=3,
        current_behavior="c",
        decision_type="general",
        reversibility=Reversibility.PARTIAL,
    )
    profile = UserProfile(priorities=["health first"], about_me="likes stability")
    merged = merge_profile_into_user_state(base, profile)
    assert merged.goals[0] == "health first"
    assert "situational goal" in merged.goals
    assert merged.profile_about_me == "likes stability"


def test_profile_round_trip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FORESIGHT_USER_ID", "u_test")
    p = UserProfile(priorities=["a"], about_me="bio", constraints=["c1"], values=["v1"])
    path = save_user_profile(p)
    assert path.is_file()
    loaded = load_user_profile()
    assert loaded.stated_priority_lines() == ["a"]
    assert loaded.about_me == "bio"
    assert loaded.constraints == ["c1"]
    assert loaded.values == ["v1"]
    assert loaded.inferred_priorities == []


@pytest.fixture
def isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("TAVILY_API_KEY", "")
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    return Settings()


def test_load_missing_profile_empty(isolated_settings: Settings) -> None:
    assert load_user_profile(isolated_settings) == UserProfile()

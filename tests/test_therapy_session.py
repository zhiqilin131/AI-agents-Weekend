"""Therapy session lifecycle on wellbeing threads."""

import pytest

from foresight_x.slime.therapy_session import (
    attach_therapy_report_artifact,
    end_therapy,
    ensure_therapy_report_artifact,
    intake_complete,
    save_wellbeing_intake,
    start_therapy,
    thread_has_therapy_report_artifact,
    therapy_status,
)


def test_intake_then_start_end() -> None:
    thread: dict = {"thread_id": "t1", "slime_type": "wellbeing"}
    save_wellbeing_intake(
        thread,
        mood_score=6,
        primary_concern="Stress",
        session_goal="Calm down",
    )
    assert intake_complete(thread)
    assert therapy_status(thread) == "not_started"
    start_therapy(thread)
    assert therapy_status(thread) == "active"
    report = {"id": "r1", "executive_summary": "Thanks for showing up."}
    end_therapy(thread, report=report)
    assert therapy_status(thread) == "ended"
    assert thread["therapy_session"]["report"]["id"] == "r1"
    assert thread["wellbeing_session"]["intake_complete"] is True


def test_start_requires_intake() -> None:
    thread: dict = {"thread_id": "t2", "slime_type": "wellbeing"}
    with pytest.raises(ValueError, match="intake_required"):
        start_therapy(thread)


def test_end_requires_active() -> None:
    thread: dict = {"thread_id": "t3", "slime_type": "wellbeing"}
    save_wellbeing_intake(thread, mood_score=5, primary_concern="X", session_goal="Y")
    with pytest.raises(ValueError, match="therapy_not_active"):
        end_therapy(thread, report={"id": "r", "executive_summary": "x"})


def test_therapy_report_artifact_in_messages() -> None:
    thread: dict = {"thread_id": "t4", "slime_type": "wellbeing", "messages": []}
    report = {"id": "r1", "executive_summary": "You showed up with care."}
    attach_therapy_report_artifact(thread, report)
    assert thread_has_therapy_report_artifact(thread)
    meta = thread["messages"][-1]["metadata"]
    assert meta["type"] == "therapy_report_artifact"
    assert meta["therapy_report"]["id"] == "r1"
    attach_therapy_report_artifact(thread, report)
    assert len(thread["messages"]) == 1


def test_ensure_therapy_report_artifact_backfill() -> None:
    report = {"id": "r2", "executive_summary": "Summary."}
    thread: dict = {
        "thread_id": "t5",
        "therapy_session": {"status": "ended", "report": report},
        "messages": [{"id": "u1", "role": "user", "content": "hi"}],
    }
    assert not thread_has_therapy_report_artifact(thread)
    assert ensure_therapy_report_artifact(thread) is True
    assert thread_has_therapy_report_artifact(thread)
    assert ensure_therapy_report_artifact(thread) is False

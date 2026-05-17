"""Wellbeing session continuity on threads."""

from foresight_x.slime.wellbeing_session import (
    build_wellbeing_session_prompt_block,
    intake_complete,
    save_wellbeing_intake,
)


def test_save_intake_marks_complete() -> None:
    thread: dict = {"thread_id": "t1", "slime_type": "wellbeing"}
    save_wellbeing_intake(
        thread,
        mood_score=7,
        primary_concern="Work stress",
        session_goal="Sleep better tonight",
    )
    assert intake_complete(thread)
    assert thread["wellbeing_session"]["mood_score"] == 7


def test_session_prompt_references_concern() -> None:
    thread = {
        "wellbeing_session": {
            "intake_complete": True,
            "mood_score": 4,
            "primary_concern": "Anxiety before exams",
            "session_goal": "Feel calmer",
            "check_in_count": 2,
        }
    }
    block = build_wellbeing_session_prompt_block(thread)
    assert "Anxiety before exams" in block
    assert "course session" in block.lower()

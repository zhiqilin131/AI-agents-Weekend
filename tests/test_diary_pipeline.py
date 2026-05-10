"""Diary two-stage pipeline: clean, quality, no transcript leakage."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from foresight_x.diary.diary_clean import clean_diary_source_bundle
from foresight_x.diary.diary_quality import validate_diary_quality
from foresight_x.diary.diary_clean import clean_diary_source_bundle
from foresight_x.diary.generator import _heuristic_diary_entry, _plan_to_entry
from foresight_x.diary.heuristic_hints import collect_concrete_hints
from foresight_x.diary.schemas import (
    CalendarItemRef,
    ChatMessageRef,
    DiaryLLMPlan,
    DiarySourceBundle,
    DiarySourceRefs,
    VoiceTurnRef,
)


def test_clean_collapses_duplicate_calendar_titles() -> None:
    bundle = DiarySourceBundle(
        date="2026-05-09",
        timezone="UTC",
        calendar_items=[
            CalendarItemRef(kind="event", id="a", title="Team sync"),
            CalendarItemRef(kind="event", id="b", title="Team sync"),
        ],
    )
    cleaned, meta = clean_diary_source_bundle(bundle)
    assert len(cleaned.calendar_items) == 1
    assert meta.duplicate_collapsed >= 1


def test_clean_filters_confirm_below_noise() -> None:
    bundle = DiarySourceBundle(
        date="2026-05-09",
        timezone="UTC",
        chat_messages=[
            ChatMessageRef(thread_id="t", message_id="1", preview="Confirm below to save it to your calendar."),
        ],
    )
    cleaned, meta = clean_diary_source_bundle(bundle)
    assert len(cleaned.chat_messages) == 0
    assert meta.noise_filtered >= 1


def test_clean_redacts_offensive_marker(monkeypatch: pytest.MonkeyPatch) -> None:
    import foresight_x.diary.diary_clean as dc

    monkeypatch.setattr(dc, "OFFENSIVE_MARKERS", ("zzzbadtokenzzz",))
    bundle = DiarySourceBundle(
        date="2026-05-09",
        timezone="UTC",
        chat_messages=[
            ChatMessageRef(thread_id="t", message_id="1", preview="Hello zzzbadtokenzzz world."),
        ],
    )
    cleaned, meta = clean_diary_source_bundle(bundle)
    assert len(cleaned.chat_messages) == 0
    assert meta.offensive_redacted >= 1


def test_validate_rejects_source_volume_phrases() -> None:
    draft = DiaryLLMPlan(
        title="Testing",
        summary="Today was fine.\n\nVolume-wise I also had 84 chat messages.",
        highlights=[],
        themes=["x"],
        tone="neutral",
    )
    q = validate_diary_quality(draft, strict_title=False)
    assert q.ok is False
    assert any("banned_phrase" in i for i in q.issues)


def test_plan_to_entry_keeps_links_from_original_bundle() -> None:
    bundle = DiarySourceBundle(
        date="2026-05-09",
        timezone="UTC",
        source_refs=DiarySourceRefs(
            message_ids=["m1"],
            thread_ids=["t1"],
        ),
        chat_messages=[ChatMessageRef(thread_id="t1", message_id="m1", preview="Hello there.")],
    )
    plan = DiaryLLMPlan(
        title="Small plans and larger questions",
        summary="A reflective paragraph.\n\nAnother calm paragraph.",
        highlights=["Calendar planning"],
        themes=["planning", "companionship"],
        tone="reflective",
    )
    entry = _plan_to_entry("u1", bundle, plan)
    assert "m1" in entry.linked_message_ids
    assert "Calendar planning" in entry.highlights
    assert "chat messages" not in entry.summary.lower()


def test_collect_concrete_hints_from_chat() -> None:
    cleaned = DiarySourceBundle(
        date="2026-05-09",
        timezone="UTC",
        chat_messages=[
            ChatMessageRef(
                thread_id="t",
                message_id="1",
                preview="We should ship the diary pipeline before the hackathon demo on Monday.",
            ),
            ChatMessageRef(
                thread_id="t",
                message_id="2",
                preview="Separate topic: tuning how Slime addresses the user in formal versus casual mode.",
            ),
        ],
    )
    hints = collect_concrete_hints(cleaned, calendar_titles=[], limit=5)
    assert len(hints) >= 1
    assert any("diary" in h.lower() or "slime" in h.lower() for h in hints)


def test_heuristic_entry_weaves_hints_not_only_vague_prose() -> None:
    bundle = DiarySourceBundle(
        date="2026-05-09",
        timezone="UTC",
        calendar_items=[CalendarItemRef(kind="event", id="e1", title="Coffee with Andrew")],
        chat_messages=[
            ChatMessageRef(
                thread_id="t",
                message_id="1",
                preview="Discussed migrating persona memory into the diary distill step carefully.",
            ),
        ],
        source_refs=DiarySourceRefs(message_ids=["1"], thread_ids=["t"]),
    )
    cleaned, _ = clean_diary_source_bundle(bundle)
    entry = _heuristic_diary_entry("u1", bundle, cleaned)
    assert "Coffee with Andrew" in entry.summary or "Andrew" in entry.summary
    assert "diary" in entry.summary.lower() or "persona" in entry.summary.lower() or "distill" in entry.summary.lower()


def test_near_duplicate_voice_collapsed() -> None:
    same = "What is your name today " * 6
    bundle = DiarySourceBundle(
        date="2026-05-09",
        timezone="UTC",
        voice_turns=[
            VoiceTurnRef(thread_id="t", message_id="1", preview=same),
            VoiceTurnRef(thread_id="t", message_id="2", preview=same),
        ],
    )
    cleaned, meta = clean_diary_source_bundle(bundle)
    assert len(cleaned.voice_turns) == 1
    assert meta.duplicate_collapsed >= 1


def test_two_stage_with_mock_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    from foresight_x.config import Settings
    from foresight_x.diary import generator as gen

    plan = DiaryLLMPlan(
        title="Small Plans, Bigger Questions",
        summary=(
            "Today seemed to move between practical arrangements and quieter questions about how "
            "this companion should feel day to day. A few calendar touches anchored the morning, "
            "while the afternoon drifted toward naming and tone.\n\n"
            "Nothing felt urgent — more like tuning an instrument. The thread that lingered longest "
            "was how formal or familiar the exchange ought to be.\n\n"
            "By evening the sensible pieces were in place, and the softer ones remained open, which "
            "felt honest rather than unfinished."
        ),
        highlights=["Calendar planning", "Companion tone"],
        themes=["planning", "identity"],
        tone="reflective",
    )

    def fake_run(llm: MagicMock, cleaned: object, meta: object, persona_context: str | None = None):
        return plan

    def fake_build(**_kw: object) -> MagicMock:
        return MagicMock()

    monkeypatch.setattr(gen, "run_two_stage_diary_llm", fake_run)
    monkeypatch.setattr(gen, "build_openai_llm", fake_build)

    bundle = DiarySourceBundle(
        date="2026-05-09",
        timezone="UTC",
        chat_messages=[
            ChatMessageRef(thread_id="t", message_id="x", preview="Ship the diary feature today."),
        ],
        source_refs=DiarySourceRefs(message_ids=["x"], thread_ids=["t"]),
    )
    settings = MagicMock(spec=Settings)
    settings.openai_api_key = "sk-test"
    entry = gen.generate_diary_entry("u1", bundle, settings=settings)
    assert entry is not None
    assert entry.title
    assert "Day notes" not in entry.title
    assert "chat messages" not in entry.summary.lower()
    q = validate_diary_quality(
        DiaryLLMPlan(title=entry.title, summary=entry.summary, highlights=entry.highlights, themes=entry.themes, tone=entry.tone or "neutral"),
        strict_title=False,
    )
    assert q.word_count <= 350

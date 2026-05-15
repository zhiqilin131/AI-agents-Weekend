"""Profile block includes onboarding personal_profile for shadow/slime turns."""

from __future__ import annotations

from foresight_x.schemas import (
    PersonalPriority,
    PersonalProfile,
    PvqResponse,
    UserProfile,
    ValuesProfile,
)
from foresight_x.shadow.chat import (
    _format_personal_profile_block,
    _format_profile_block,
    collect_user_stated_priority_texts,
    collect_user_stated_value_texts,
    is_priority_or_values_recall_question,
)


def test_format_personal_profile_block_priorities_and_values() -> None:
    prof = UserProfile(
        personal_profile=PersonalProfile(
            priorities=[
                PersonalPriority(
                    id="p1",
                    domain="work",
                    text="Ship the hackathon demo",
                    createdAt="2026-05-01T00:00:00Z",
                    updatedAt="2026-05-01T00:00:00Z",
                )
            ],
            valuesProfile=ValuesProfile(
                narrative="I value autonomy and steady progress over hype.",
                generatedAt="2026-05-01T00:00:00Z",
            ),
        )
    )
    block = _format_personal_profile_block(prof)
    assert "AUTHORITATIVE" in block
    assert "Ship the hackathon demo" in block
    assert "VALUES" in block
    assert "autonomy" in block


def test_format_profile_block_merges_onboarding_with_legacy() -> None:
    prof = UserProfile(
        user_priorities=["Legacy priority line"],
        personal_profile=PersonalProfile(
            priorities=[
                PersonalPriority(
                    id="p1",
                    domain="health",
                    text="Sleep eight hours",
                    createdAt="2026-05-01T00:00:00Z",
                    updatedAt="2026-05-01T00:00:00Z",
                )
            ],
        ),
    )
    block = _format_profile_block(prof)
    assert "AUTHORITATIVE" in block
    assert "Sleep eight hours" in block
    assert "Profile priorities (user-authored)" in block
    assert "Legacy priority line" in block


def test_collect_user_stated_priority_texts_merges_sources() -> None:
    prof = UserProfile(
        user_priorities=["From flat list"],
        personal_profile=PersonalProfile(
            priorities=[
                PersonalPriority(
                    id="p1",
                    domain="work",
                    text="Onboarding priority A",
                    createdAt="2026-05-01T00:00:00Z",
                    updatedAt="2026-05-01T00:00:00Z",
                )
            ],
        ),
    )
    texts = collect_user_stated_priority_texts(prof)
    assert "Onboarding priority A" in texts
    assert "From flat list" in texts


def test_is_priority_recall_question() -> None:
    assert is_priority_or_values_recall_question("Hi, what are my priorities?")
    assert is_priority_or_values_recall_question("What are my values?")
    assert not is_priority_or_values_recall_question("What did I just say?")


def test_collect_user_stated_value_texts() -> None:
    prof = UserProfile(
        values=["legacy"],
        personal_profile=PersonalProfile(
            valuesProfile=ValuesProfile(
                pvqResponses=[
                    PvqResponse(portraitId=1, portraitKey="achievement", score="very_like"),
                ],
                narrative="Care about growth.",
            ),
        ),
    )
    vals = collect_user_stated_value_texts(prof)
    assert any("achievement" in v for v in vals)
    assert "legacy" in vals


def test_format_personal_profile_includes_values_authoritative() -> None:
    prof = UserProfile(
        personal_profile=PersonalProfile(
            priorities=[
                PersonalPriority(
                    id="p1",
                    domain="work",
                    text="Family first",
                    createdAt="2026-05-01T00:00:00Z",
                    updatedAt="2026-05-01T00:00:00Z",
                )
            ],
            valuesProfile=ValuesProfile(
                pvqResponses=[PvqResponse(portraitId=2, portraitKey="security", score="very_like")],
                narrative="Stability matters.",
            ),
        )
    )
    block = _format_personal_profile_block(prof)
    assert "AUTHORITATIVE" in block
    assert "VALUES" in block
    assert "Family first" in block
    assert "stability" in block.lower()

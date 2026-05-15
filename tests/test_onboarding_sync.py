"""Onboarding personal_profile sync into profile priorities and values."""

from __future__ import annotations

from foresight_x.profile.onboarding_sync import (
    hydrate_profile_from_onboarding,
    stated_priorities_for_put,
    value_keywords_from_personal_profile,
    values_for_put,
)
from foresight_x.schemas import (
    OnboardingStatus,
    PersonalPriority,
    PersonalProfile,
    PvqResponse,
    UserProfile,
    ValuesProfile,
)


def _sample_personal_profile() -> PersonalProfile:
    return PersonalProfile(
        priorities=[
            PersonalPriority(
                id="p1",
                domain="work",
                text="Ship meaningful product work",
                createdAt="2026-05-01T00:00:00Z",
                updatedAt="2026-05-01T00:00:00Z",
            )
        ],
        valuesProfile=ValuesProfile(
            pvqResponses=[
                PvqResponse(portraitId=3, portraitKey="autonomy", score="very_like"),
                PvqResponse(portraitId=6, portraitKey="exploration", score="somewhat_like"),
            ],
            narrative="You value autonomy and trying new things.",
            generatedAt="2026-05-01T00:00:00Z",
        ),
        onboardingStatus=OnboardingStatus(completed=True, completedAt="2026-05-01T00:00:00Z"),
    )


def test_value_keywords_from_pvq() -> None:
    kws = value_keywords_from_personal_profile(_sample_personal_profile())
    assert "autonomy and self-direction" in kws
    assert "novelty and exploration" in kws


def test_stated_priorities_for_put_uses_onboarding_when_body_empty() -> None:
    existing = UserProfile()
    body = UserProfile(personal_profile=_sample_personal_profile())
    pp = body.personal_profile
    stated = stated_priorities_for_put(body, existing, pp)
    assert "Ship meaningful product work" in stated


def test_values_for_put_merges_onboarding() -> None:
    existing = UserProfile(values=["legacy value"])
    body = UserProfile(personal_profile=_sample_personal_profile())
    vals = values_for_put(body, existing, body.personal_profile)
    assert "autonomy and self-direction" in vals
    assert "legacy value" in vals


def test_hydrate_profile_from_onboarding() -> None:
    prof = UserProfile(personal_profile=_sample_personal_profile())
    out = hydrate_profile_from_onboarding(prof)
    assert "Ship meaningful product work" in out.user_priorities
    assert any("autonomy" in v for v in out.values)

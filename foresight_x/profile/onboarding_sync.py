"""Mirror onboarding ``personal_profile`` into legacy profile priorities/values fields."""

from __future__ import annotations

from foresight_x.schemas import PersonalProfile, UserProfile

# Mirrors web/src/features/onboarding/onboarding.ts PVQ_PORTRAITS keywords.
_PVQ_KEYWORD_BY_PORTRAIT_ID: dict[int, str] = {
    1: "achievement and being recognized",
    2: "stability and predictability",
    3: "autonomy and self-direction",
    4: "deep relationships and being understood",
    5: "tradition, belonging, and roots",
    6: "novelty and exploration",
    7: "altruism and fairness",
    8: "present-moment enjoyment",
}

_POSITIVE_PVQ_SCORES = frozenset({"very_like", "somewhat_like"})


def priority_texts_from_personal_profile(pp: PersonalProfile | None) -> list[str]:
    if pp is None:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in pp.priorities or []:
        t = str(item.text or "").strip()
        if len(t) < 2:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t[:200])
    return out


def value_keywords_from_personal_profile(pp: PersonalProfile | None) -> list[str]:
    if pp is None:
        return []
    out: list[str] = []
    seen: set[str] = set()

    def _add(raw: str) -> None:
        t = str(raw or "").strip()
        if len(t) < 2:
            return
        key = t.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(t[:120])

    vp = pp.valuesProfile
    for resp in vp.pvqResponses or []:
        if str(resp.score or "") not in _POSITIVE_PVQ_SCORES:
            continue
        kw = _PVQ_KEYWORD_BY_PORTRAIT_ID.get(int(resp.portraitId))
        if kw:
            _add(kw)
        elif resp.portraitKey:
            _add(str(resp.portraitKey).replace("_", " "))
    narrative = (vp.narrative or "").strip()
    if narrative:
        _add(narrative[:200])
    return out


def merge_unique_texts(*groups: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for group in groups:
        for raw in group:
            t = str(raw or "").strip()
            if len(t) < 2:
                continue
            key = t.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(t)
    return out


def should_apply_incoming_personal_profile(body: UserProfile, existing: UserProfile) -> bool:
    incoming = body.personal_profile
    if incoming is None:
        return False
    if "personal_profile" in body.model_fields_set:
        return True
    if incoming.priorities:
        return True
    if (incoming.valuesProfile.narrative or "").strip():
        return True
    if incoming.valuesProfile.pvqResponses:
        return True
    return bool(incoming.onboardingStatus.completed)


def resolve_personal_profile_for_put(body: UserProfile, existing: UserProfile) -> PersonalProfile:
    if should_apply_incoming_personal_profile(body, existing):
        return body.personal_profile
    return existing.personal_profile


def stated_priorities_for_put(
    body: UserProfile,
    existing: UserProfile,
    personal_profile: PersonalProfile,
) -> list[str]:
    """Priority lines for PUT: body lists, then onboarding, then existing profile channel."""
    body_stated = list(body.user_priorities or body.priorities or [])
    onboarding_stated = priority_texts_from_personal_profile(personal_profile)
    existing_stated = existing.profile_channel_priority_texts()
    if body_stated:
        return merge_unique_texts(body_stated, onboarding_stated)
    if onboarding_stated:
        return merge_unique_texts(onboarding_stated, existing_stated)
    return list(existing_stated)


def values_for_put(
    body: UserProfile,
    existing: UserProfile,
    personal_profile: PersonalProfile,
) -> list[str]:
    body_values = list(body.values or [])
    onboarding_values = value_keywords_from_personal_profile(personal_profile)
    existing_values = list(existing.values or [])
    if body_values:
        return merge_unique_texts(body_values, onboarding_values)
    if onboarding_values:
        return merge_unique_texts(onboarding_values, existing_values)
    return existing_values


def hydrate_profile_from_onboarding(profile: UserProfile) -> UserProfile:
    """On load/save: keep flat priorities/values in sync with personal_profile."""
    pp = profile.personal_profile
    onboarding_prio = priority_texts_from_personal_profile(pp)
    onboarding_vals = value_keywords_from_personal_profile(pp)
    if not onboarding_prio and not onboarding_vals:
        return profile

    stated = merge_unique_texts(
        profile.stated_priority_lines(),
        onboarding_prio,
    )
    values = merge_unique_texts(list(profile.values or []), onboarding_vals)
    return profile.model_copy(
        update={
            "user_priorities": stated,
            "priorities": stated,
            "values": values,
        }
    )

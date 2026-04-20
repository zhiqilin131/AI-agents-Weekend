"""Merge persisted profile into ``UserState`` for retrieval and prompts."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from foresight_x.schemas import (
    MemoryFactCategory,
    MemoryFactSource,
    ProfileLine,
    ProfileLineChannel,
    ProfileMemoryFact,
    UserProfile,
    UserState,
)


def _utc_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def append_clarification_to_profile(profile: UserProfile, answers: dict[str, str]) -> UserProfile:
    """Persist structured clarification choices as short user-owned priority lines (deduped)."""
    if not answers:
        return profile
    profile = UserProfile.model_validate(profile.model_dump(mode="json"))
    pl = list(profile.priority_lines)
    seen_user = {x.text.strip().lower() for x in pl if x.origin == "user"}
    ts = _utc_ts()
    for qid, label in answers.items():
        q = str(qid).strip().replace("_", " ")
        line = f"{q}: {str(label).strip()}"
        key = line.lower()
        if key in seen_user:
            continue
        seen_user.add(key)
        pl.append(ProfileLine(id=str(uuid.uuid4()), text=line, origin="user", channel="clarification", created_at=ts))
    u = [x.text for x in pl if x.origin == "user"]
    i = [x.text for x in pl if x.origin == "system"]
    return profile.model_copy(
        update={
            "priority_lines": pl,
            "user_priorities": u,
            "priorities": u,
            "inferred_priorities": i,
        }
    )


def append_inferred_priority_line(
    profile: UserProfile,
    line: str,
    *,
    channel: ProfileLineChannel = "shadow",
    max_lines: int = 48,
) -> UserProfile:
    """Append one system line (e.g. from shadow chat); dedupe case-insensitively on text."""
    text = (line or "").strip()
    if not text:
        return profile
    profile = UserProfile.model_validate(profile.model_dump(mode="json"))
    pl = list(profile.priority_lines)
    key = text.lower()
    if any(x.origin == "system" and x.text.strip().lower() == key for x in pl):
        return profile
    ts = _utc_ts()
    pl.append(ProfileLine(id=str(uuid.uuid4()), text=text, origin="system", channel=channel, created_at=ts))
    users = [x for x in pl if x.origin == "user"]
    systems = [x for x in pl if x.origin == "system"]
    if len(systems) > max_lines:
        systems = systems[-max_lines:]
    pl = users + systems
    u = [x.text for x in users]
    i = [x.text for x in systems]
    return profile.model_copy(
        update={
            "priority_lines": pl,
            "user_priorities": u,
            "priorities": u,
            "inferred_priorities": i,
        }
    )


def merge_profile_into_user_state(user_state: UserState, profile: UserProfile) -> UserState:
    profile_only = profile.profile_channel_priority_texts()
    clar = profile.clarification_priority_texts()
    inferred = list(profile.inferred_priorities)
    facts = list(profile.memory_facts)
    fact_strings = [f"{x.category.value}: {x.text}" for x in facts]
    combined = list(dict.fromkeys([*profile_only, *clar, *inferred, *fact_strings]))
    merged_goals = list(dict.fromkeys([*profile_only, *clar, *inferred, *fact_strings, *user_state.goals]))
    return user_state.model_copy(
        update={
            "goals": merged_goals,
            "profile_user_priorities": profile_only,
            "profile_clarification_priorities": clar,
            "profile_inferred_priorities": inferred,
            "profile_memory_facts": facts,
            "profile_priorities": combined,
            "profile_about_me": profile.about_me,
            "profile_constraints": list(profile.constraints),
            "profile_values": list(profile.values),
        }
    )


def normalize_profile_ids(profile: UserProfile) -> tuple[UserProfile, bool]:
    """Assign UUIDs to priority lines and memory facts missing ids; returns (profile, changed)."""
    changed = False
    pl: list[ProfileLine] = []
    for line in profile.priority_lines:
        if not (line.id or "").strip():
            pl.append(line.model_copy(update={"id": str(uuid.uuid4())}))
            changed = True
        else:
            pl.append(line)
    mf: list[ProfileMemoryFact] = []
    for fact in profile.memory_facts:
        if not (fact.id or "").strip():
            mf.append(fact.model_copy(update={"id": str(uuid.uuid4())}))
            changed = True
        else:
            mf.append(fact)
    if not changed:
        return profile, False
    return profile.model_copy(update={"priority_lines": pl, "memory_facts": mf}), True


def append_memory_facts(
    profile: UserProfile,
    items: list[tuple[MemoryFactCategory, str]],
    *,
    source: MemoryFactSource = "shadow",
    max_facts: int = 64,
) -> UserProfile:
    """Append categorized facts; dedupes on (category, text) case-insensitively."""
    profile = UserProfile.model_validate(profile.model_dump(mode="json"))
    ts = _utc_ts()
    existing = {(f.category, f.text.strip().lower()) for f in profile.memory_facts}
    mf = list(profile.memory_facts)
    for cat, raw in items:
        text = (raw or "").strip()
        if not text:
            continue
        key = (cat, text.lower())
        if key in existing:
            continue
        existing.add(key)
        mf.append(
            ProfileMemoryFact(
                id=str(uuid.uuid4()),
                category=cat,
                text=text[:500],
                source=source,
                created_at=ts,
            )
        )
    if len(mf) > max_facts:
        mf = mf[-max_facts:]
    return profile.model_copy(update={"memory_facts": mf})


def delete_priority_line_by_id(profile: UserProfile, line_id: str) -> UserProfile | None:
    """Remove one priority line by id; returns None if not found."""
    lid = (line_id or "").strip()
    if not lid:
        return None
    profile = UserProfile.model_validate(profile.model_dump(mode="json"))
    pl = [x for x in profile.priority_lines if x.id != lid]
    if len(pl) == len(profile.priority_lines):
        return None
    u = [x.text for x in pl if x.origin == "user"]
    i = [x.text for x in pl if x.origin == "system"]
    return profile.model_copy(
        update={
            "priority_lines": pl,
            "user_priorities": u,
            "priorities": list(u),
            "inferred_priorities": i,
        }
    )


def delete_memory_fact_by_id(profile: UserProfile, fact_id: str) -> UserProfile | None:
    fid = (fact_id or "").strip()
    if not fid:
        return None
    profile = UserProfile.model_validate(profile.model_dump(mode="json"))
    mf = [x for x in profile.memory_facts if x.id != fid]
    if len(mf) == len(profile.memory_facts):
        return None
    return profile.model_copy(update={"memory_facts": mf})

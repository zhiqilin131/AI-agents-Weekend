"""Inject user-local \"recent context\" into EvidenceBundle.recent_events.

World Chroma rarely emits ``kind=recent_event`` rows, so this bucket was often empty.
We populate it from Shadow reflective notes and past decision traces on disk.
"""

from __future__ import annotations

from foresight_x.config import Settings, load_settings
from foresight_x.harness.trace_index import list_traces
from foresight_x.schemas import EvidenceBundle, Fact
from foresight_x.shadow.store import load_shadow_self


def _dedupe_facts_by_text(items: list[Fact]) -> list[Fact]:
    seen: set[str] = set()
    out: list[Fact] = []
    for f in items:
        key = " ".join((f.text or "").split()).strip().lower()[:4000]
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


def _truncate(s: str, max_len: int = 420) -> str:
    s = (s or "").strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def facts_from_user_local_context(*, settings: Settings | None = None, max_shadow: int = 8, max_traces: int = 8) -> list[Fact]:
    """Build Fact lines for Shadow chat notes + recent saved decision traces."""
    s = settings or load_settings()
    facts: list[Fact] = []

    shadow = load_shadow_self(settings=s)
    obs = list(shadow.observations or [])
    for line in obs[-max_shadow:]:
        t = _truncate(line, 500)
        if not t:
            continue
        facts.append(
            Fact(
                text=f"Shadow (reflective chat) note: {t}",
                source_url=None,
                confidence=0.55,
            )
        )

    for row in list_traces(settings=s)[:max_traces]:
        prev = _truncate(row.preview or row.decision_id, 360)
        facts.append(
            Fact(
                text=f"Past decision ({row.timestamp} · {row.decision_type}): {prev}",
                source_url=None,
                confidence=0.5,
            )
        )

    return _dedupe_facts_by_text(facts)


def merge_user_context_into_evidence(evidence: EvidenceBundle, settings: Settings | None = None) -> EvidenceBundle:
    """Append user-local facts to ``recent_events`` (deduped)."""
    extra = facts_from_user_local_context(settings=settings)
    if not extra:
        return evidence
    combined = _dedupe_facts_by_text(list(evidence.recent_events) + extra)
    return evidence.model_copy(update={"recent_events": combined})

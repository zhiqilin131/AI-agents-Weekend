"""Inject user-local context into EvidenceBundle.recent_events.

When ``user_state`` (+ optional ``memory_bundle``) are provided, we build
``recent_events`` with :mod:`foresight_x.retrieval.recent_events_fusion` — RRF
across vector memory order, on-disk trace order, and recorded outcomes, plus
MMR-filtered Shadow lines aligned to the current query. Legacy callers that omit
``user_state`` keep the older Shadow+trace preview behavior (tests).
"""

from __future__ import annotations

from foresight_x.config import Settings, load_settings
from foresight_x.harness.trace_index import list_traces
from foresight_x.retrieval.recent_events_fusion import build_fused_recent_facts
from foresight_x.schemas import EvidenceBundle, Fact, MemoryBundle, UserState
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


def facts_from_user_local_context(
    *,
    settings: Settings | None = None,
    user_state: UserState | None = None,
    memory_bundle: MemoryBundle | None = None,
    exclude_decision_id: str | None = None,
) -> list[Fact]:
    """Build Fact lines for recent_events (fusion path when ``user_state`` is set)."""
    s = settings or load_settings()
    if user_state is not None:
        return build_fused_recent_facts(
            s,
            user_state,
            memory_bundle,
            exclude_decision_id=exclude_decision_id,
        )
    return _legacy_facts_from_user_local_context(s)


def _legacy_facts_from_user_local_context(settings: Settings) -> list[Fact]:
    """Shadow tail + trace previews only (backward-compatible tests / callers)."""
    facts: list[Fact] = []

    shadow = load_shadow_self(settings=settings)
    obs = list(shadow.observations or [])
    for line in obs[-8:]:
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

    for row in list_traces(settings=settings)[:8]:
        prev = _truncate(row.preview or row.decision_id, 360)
        facts.append(
            Fact(
                text=f"Past decision ({row.timestamp} · {row.decision_type}): {prev}",
                source_url=None,
                confidence=0.5,
            )
        )

    return _dedupe_facts_by_text(facts)


def merge_user_context_into_evidence(
    evidence: EvidenceBundle,
    settings: Settings | None = None,
    *,
    user_state: UserState | None = None,
    memory_bundle: MemoryBundle | None = None,
    exclude_decision_id: str | None = None,
) -> EvidenceBundle:
    """Append user-local facts to ``recent_events`` (deduped)."""
    s = settings or load_settings()
    extra = facts_from_user_local_context(
        settings=s,
        user_state=user_state,
        memory_bundle=memory_bundle,
        exclude_decision_id=exclude_decision_id,
    )
    if not extra:
        return evidence
    # User-local decision history + Shadow before world ``recent_event`` lines so memory-aligned context leads.
    combined = _dedupe_facts_by_text(extra + list(evidence.recent_events))
    return evidence.model_copy(update={"recent_events": combined})

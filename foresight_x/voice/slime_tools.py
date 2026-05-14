"""Validated Slime voice tool execution (server-side)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

from pydantic import ValidationError

from foresight_x.chat.thread_store import list_threads, load_thread
from foresight_x.config import Settings
from foresight_x.harness.trace_index import list_traces
from foresight_x.profile.memory_structured import (
    active_memory_facts,
    format_memory_fact_prompt_line,
    user_scope_memory_facts,
)
from foresight_x.profile.memory_rules import rank_memory_facts_for_query
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import (
    SlimeAccessory,
    SlimeColorTheme,
    SlimeCustomColors,
    SlimeMotion,
    SlimePersonality,
    SlimePersona,
    SlimeProfile,
    SlimeShape,
    SlimeVoicePreferences,
    UserProfile,
)
from foresight_x.voice.slime_memory_synthesis import MemoryEvidenceItem, evidence_items_from_hits, synthesize_memory_answer
from foresight_x.voice.slime_identity import EffectiveSlimePersona, get_effective_slime_persona
from foresight_x.voice.slime_persona_prompt import merge_persona_patch, merge_slime_persona_defaults
from foresight_x.voice.slime_voice_router import SlimeVoiceContext, SlimeVoiceRouteResult
from foresight_x.voice.slime_voice_synthesis import synthesize_persona_spoken_reply


def _voice_profile_patch_json(patch: dict[str, Any]) -> dict[str, Any]:
    """JSON-serialize values for voice-command HTTP responses (tool_result / frontend_action)."""
    out: dict[str, Any] = {}
    for k, v in patch.items():
        if hasattr(v, "model_dump"):
            out[k] = v.model_dump(mode="json")
        elif isinstance(v, Enum):
            out[k] = v.value
        else:
            out[k] = v
    return out


def _slime_voice_persona_bundle(settings: Settings) -> tuple[EffectiveSlimePersona, SlimePersona | None]:
    eff = get_effective_slime_persona(settings)
    prof = load_user_profile(settings)
    raw_persona = prof.slime_profile.persona if prof.slime_profile else None
    return eff, raw_persona


def _persona_spoken(
    neutral: str,
    *,
    tool_name: str,
    transcript: str,
    settings: Settings,
) -> str:
    eff, raw_persona = _slime_voice_persona_bundle(settings)
    return synthesize_persona_spoken_reply(
        neutral_reply=neutral,
        transcript=transcript,
        tool_name=tool_name,
        slime_persona=raw_persona,
        slime_name=eff.name,
        user_ref=eff.user_nickname_for_address,
        slime_profile_saved=eff.profile_saved,
        settings=settings,
        effective=eff,
    )


ROUTE_TO_PATH: dict[str, str] = {
    "home": "/",
    "profile": "/profile",
    "user_profile": "/profile",
    "my_profile": "/profile",
    "account": "/profile",
    "shadow_chat": "/chat",
    "chat": "/chat",
    "execution_calendar": "/execution",
    "calendar": "/execution",
    "planner": "/execution",
    "history": "/history",
    "settings": "/profile",
    "diary": "/diary",
    "journal": "/diary",
    "buddy": "/buddy",
    "slime_buddy": "/buddy",
    "reflect": "/reflect",
}


def _tokens(q: str) -> set[str]:
    raw = [t.lower() for t in re.findall(r"[a-zA-Z0-9']{2,}|[\u4e00-\u9fff]+", q or "")]
    stop = {
        "a",
        "an",
        "and",
        "are",
        "can",
        "do",
        "does",
        "for",
        "how",
        "is",
        "it",
        "me",
        "my",
        "of",
        "the",
        "to",
        "what",
        "who",
        "you",
        "your",
        "about",
        "remember",
        "tell",
        "just",
    }
    toks = {t for t in raw if len(t) >= 3 and t not in stop}
    joined = " ".join(raw)
    if any(x in joined for x in ("girlfriend", "boyfriend", "partner", "dating", "relationship")) or re.search(
        r"女朋友|男朋友|对象|伴侣|恋爱|关系", q or ""
    ):
        toks.update({"girlfriend", "boyfriend", "partner", "dating", "relationship", "romantic"})
    if any(x in joined for x in ("life", "routine", "daily", "day", "lifestyle", "living")) or re.search(
        r"生活|日常|人生|平时", q or ""
    ):
        toks.update({"life", "routine", "daily", "school", "study", "work", "relationship", "goal", "habit"})
    return toks


def _is_broad_user_memory_query(query: str) -> bool:
    q = (query or "").strip().lower()
    return bool(
        re.search(
            r"\b(what do you know about me|what is my life like|my life|who am i|about me|remember about me)\b",
            q,
        )
        or re.search(r"了解我|关于我|我的生活|我是谁|记得我", query or "")
    )


def _is_relationship_hit(h: dict[str, Any]) -> bool:
    text = str(h.get("text") or "").lower()
    pred = str(h.get("predicate") or "").lower()
    return any(
        token in " ".join([text, pred])
        for token in ("girlfriend", "boyfriend", "partner", "dating", "relationship", "roommate", "friend")
    )


def _is_project_hit(h: dict[str, Any]) -> bool:
    text = str(h.get("text") or "").lower()
    pred = str(h.get("predicate") or "").lower()
    return any(token in " ".join([text, pred]) for token in ("project", "foresight", "startup", "research", "app", "building"))


def _memory_hit_bucket(h: dict[str, Any]) -> str:
    kind = str(h.get("kind") or "")
    category = str(h.get("category") or "").lower()
    if kind != "memory_fact":
        return kind
    if _is_relationship_hit(h):
        return "relationship"
    if _is_project_hit(h):
        return "project"
    return category or "memory_fact"


def _score_text(text: str, tokens: set[str]) -> float:
    if not text or not tokens:
        return 0.0
    low = text.lower()
    score = 0.0
    for t in tokens:
        if t in low:
            score += 1.35 if len(t) >= 6 else 1.0
    return score / max(len(tokens), 1)


def _profile_fact_text_for_search(f: Any) -> str:
    bits = [
        str(getattr(f, "text", "") or ""),
        format_memory_fact_prompt_line(f),
        str(getattr(f, "evidence", "") or ""),
        str(getattr(f, "category", "") or ""),
    ]
    pred = str(getattr(f, "predicate", "") or "")
    obj = str(getattr(f, "object_value", "") or "")
    if pred or obj:
        bits.append(f"{pred.replace('_', ' ')} {obj}")
    return " | ".join(x.strip() for x in bits if x and x.strip())


def _profile_fact_display_text(f: Any) -> str:
    text = str(getattr(f, "text", "") or "").strip()
    structured = format_memory_fact_prompt_line(f).strip()
    evidence = str(getattr(f, "evidence", "") or "").strip()
    parts: list[str] = []
    if text:
        parts.append(text)
    if structured and structured.lower() != text.lower():
        parts.append(f"structured: {structured}")
    if evidence:
        parts.append(f"evidence: {evidence}")
    return " | ".join(parts)[:900] if parts else structured[:900]


def _search_profile_and_memory(profile: UserProfile, query: str, tokens: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    broad = _is_broad_user_memory_query(query)
    if profile.about_me:
        score = _score_text(profile.about_me, tokens)
        if score > 0 or broad:
            out.append({"kind": "about_me", "text": profile.about_me[:500], "id": None, "score": score + 0.18})
    for pl in profile.priority_lines or []:
        text = getattr(pl, "text", None) or str(pl)
        score = _score_text(text, tokens)
        if score > 0 or broad:
            out.append({"kind": "priority_line", "text": text[:500], "id": getattr(pl, "id", None), "score": score + 0.12})
    facts = rank_memory_facts_for_query(
        user_scope_memory_facts(active_memory_facts(list(profile.memory_facts or []))),
        query,
        limit=24,
    )
    direct_memory_q = _is_broad_user_memory_query(query) or bool(
        re.search(r"\b(who|what)\b", query.lower()) and re.search(r"\b(remember|know|saved|profile|girlfriend|boyfriend|partner)\b", query.lower())
    )
    for idx, f in enumerate(facts):
        search_text = _profile_fact_text_for_search(f)
        score = _score_text(search_text, tokens)
        rels = getattr(f, "relationships", None) or []
        rel_boost = min(0.16, 0.04 * len(rels)) if isinstance(rels, list) else 0.0
        if score > 0 or broad or (direct_memory_q and idx < 4):
            fid = getattr(f, "id", None)
            category = str(getattr(getattr(f, "category", None), "value", getattr(f, "category", "")) or "")
            category_boost = 0.08 if category in ("identity", "goals", "constraints") else 0.04
            importance_boost = min(0.2, max(0.0, float(getattr(f, "importance", 0.0) or 0.0)) * 0.18)
            recency_boost = 0.06 if str(getattr(f, "last_reinforced_at", "") or getattr(f, "updated_at", "")).strip() else 0.0
            intent_boost = 0.05 if (direct_memory_q and category in ("identity", "goals", "constraints", "views")) else 0.0
            out.append(
                {
                    "kind": "memory_fact",
                    "text": _profile_fact_display_text(f),
                    "id": fid,
                    "score": score + 0.25 + category_boost + importance_boost + recency_boost + rel_boost + intent_boost,
                    "category": category,
                    "predicate": str(getattr(f, "predicate", "") or ""),
                    "confidence": float(getattr(f, "confidence", 0.7) or 0.7),
                    "importance": float(getattr(f, "importance", 0.5) or 0.5),
                    "created_at": str(getattr(f, "created_at", "") or ""),
                    "updated_at": str(getattr(f, "updated_at", "") or ""),
                    "last_reinforced_at": str(getattr(f, "last_reinforced_at", "") or ""),
                }
            )
    return out[:36]


def _search_chat_history(settings: Settings, query: str, tokens: set[str], thread_id: str | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    uid = settings.foresight_user_id
    broad = _is_broad_user_memory_query(query)

    def collect_thread(tid: str, *, current: bool = False) -> None:
        t = load_thread(tid, user_id=uid)
        msgs = t.get("messages") or []
        ws = str(t.get("working_summary") or "")
        boost = 0.12 if current else 0.0
        score = _score_text(ws, tokens)
        if ws and (score > 0 or broad):
            out.append({"kind": "thread_summary", "thread_id": tid, "text": ws[:500], "score": score + boost + (0.08 if broad else 0.0)})
        for m in msgs:
            if str(m.get("role")) != "user":
                continue
            c = str(m.get("content") or "")
            score = _score_text(c, tokens)
            if score > 0 or (broad and len(c.strip()) >= 24):
                out.append(
                    {
                        "kind": "chat_message",
                        "thread_id": tid,
                        "message_id": m.get("id"),
                        "text": c[:500],
                        "score": score + boost + (0.04 if broad else 0.0),
                    }
                )

    if thread_id:
        collect_thread(thread_id, current=True)

    metas = list_threads(user_id=uid)[:25]
    for meta in metas:
        tid = str(meta.get("thread_id") or "")
        if not tid or tid == thread_id:
            continue
        collect_thread(tid)
        if len(out) >= 18:
            break
    return out[:18]


def _search_decision_reports(settings: Settings, query: str, tokens: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    broad = _is_broad_user_memory_query(query)
    for item in list_traces(settings=settings)[:40]:
        preview = f"{item.preview} {item.decision_type}"
        score = _score_text(preview, tokens)
        if score > 0 or broad:
            out.append(
                {
                    "kind": "decision_trace",
                    "decision_id": item.decision_id,
                    "text": preview[:300],
                    "timestamp": item.timestamp,
                    "score": score + (0.05 if broad else 0.0),
                }
            )
    return out[:12]


def _rank_memory_hits(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source_boost = {
        "memory_fact": 0.35,
        "about_me": 0.28,
        "priority_line": 0.2,
        "thread_summary": 0.16,
        "chat_message": 0.12,
        "decision_trace": 0.08,
    }
    ranked = list(hits)
    for h in ranked:
        kind = str(h.get("kind") or "")
        h["rank_score"] = float(h.get("score") or 0.0) + source_boost.get(kind, 0.0)
    ranked.sort(key=lambda h: float(h.get("rank_score") or 0.0), reverse=True)
    return ranked


def _dedupe_memory_hits(ranked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for h in ranked:
        key = " ".join(str(h.get("text") or "").lower().split())[:120]
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(h)
    return unique


def _diversify_memory_hits(ranked: list[dict[str, Any]], *, broad: bool, limit: int = 10) -> list[dict[str, Any]]:
    if not broad:
        return ranked[:limit]

    priority_buckets = (
        "identity",
        "relationship",
        "project",
        "goals",
        "constraints",
        "behavior",
        "views",
        "about_me",
        "thread_summary",
        "chat_message",
        "decision_trace",
        "priority_line",
    )
    selected: list[dict[str, Any]] = []
    used_ids: set[int] = set()

    for bucket in priority_buckets:
        if len(selected) >= limit:
            break
        for idx, h in enumerate(ranked):
            if idx in used_ids:
                continue
            if _memory_hit_bucket(h) == bucket:
                selected.append(h)
                used_ids.add(idx)
                break

    for idx, h in enumerate(ranked):
        if len(selected) >= limit:
            break
        if idx not in used_ids:
            selected.append(h)
            used_ids.add(idx)
    return selected[:limit]


def tool_search_memory(
    args: dict[str, Any],
    *,
    context: SlimeVoiceContext,
    settings: Settings,
) -> tuple[dict[str, Any], dict[str, Any]]:
    query = str(args.get("query") or "").strip()
    scope = str(args.get("scope") or "all").strip().lower()
    if scope not in ("profile", "chat_history", "decision_reports", "all"):
        scope = "all"
    if not query:
        return (
            {"hits": [], "evidence_items": [], "summary": ""},
            {"type": "none"},
        )

    tokens = _tokens(query)
    profile = load_user_profile(settings)
    hits: list[dict[str, Any]] = []

    if scope in ("profile", "all"):
        hits.extend(_search_profile_and_memory(profile, query, tokens))
    if scope in ("chat_history", "all"):
        hits.extend(_search_chat_history(settings, query, tokens, context.thread_id))
    if scope in ("decision_reports", "all"):
        hits.extend(_search_decision_reports(settings, query, tokens))

    broad = _is_broad_user_memory_query(query)
    unique = _dedupe_memory_hits(_rank_memory_hits(hits))
    selected = _diversify_memory_hits(unique, broad=broad, limit=10)

    if not selected:
        return (
            {
                "hits": [],
                "evidence_items": [],
                "summary": "",
            },
            {
                "type": "show_memory_result",
                "payload": {"evidence_items": [], "display_mode": "chips"},
            },
        )

    evidence_models = evidence_items_from_hits(selected)
    evidence_items = [e.model_dump(mode="json") for e in evidence_models]
    return (
        {
            "hits": selected,
            "evidence_items": evidence_items,
            "summary": "",
        },
        {
            "type": "show_memory_result",
            "payload": {
                "evidence_items": evidence_items,
                "display_mode": "chips",
            },
        },
    )


def tool_navigate(args: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    route = str(args.get("route") or "").strip().lower().replace("-", "_").replace(" ", "_")
    if route not in ROUTE_TO_PATH:
        return {"ok": False, "error": "invalid_route"}, {"type": "none"}
    path = ROUTE_TO_PATH[route]
    return {"ok": True, "route": route, "path": path}, {"type": "navigate", "route": path, "payload": {}}


def _parse_event_dt(raw: str) -> datetime | None:
    t = (raw or "").strip()
    if not t:
        return None
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(t)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _calendar_range_bounds(range_name: str, *, now: datetime) -> tuple[datetime | None, datetime | None, str]:
    raw = (range_name or "").strip().lower()
    r = raw
    if r not in {"today", "tomorrow", "week", "all"}:
        if "tomorrow" in raw or "明天" in raw:
            r = "tomorrow"
        elif "today" in raw or "tonight" in raw or "今天" in raw:
            r = "today"
        elif "all" in raw or "everything" in raw or "全部" in raw:
            r = "all"
        else:
            r = "week"
    local_now = now.astimezone()
    start_day = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    if r == "today":
        return start_day, start_day + timedelta(days=1), "today"
    if r == "tomorrow":
        s = start_day + timedelta(days=1)
        return s, s + timedelta(days=1), "tomorrow"
    if r == "week":
        s = start_day - timedelta(days=start_day.weekday())
        return s, s + timedelta(days=7), "this week"
    return None, None, "your calendar"


def _event_time_phrase(start: datetime, end: datetime) -> str:
    same_day = start.date() == end.date()
    if same_day:
        return f"{start.strftime('%a %b %-d, %-I:%M %p')}–{end.strftime('%-I:%M %p')}"
    return f"{start.strftime('%a %b %-d, %-I:%M %p')}–{end.strftime('%a %b %-d, %-I:%M %p')}"


def tool_search_calendar(
    args: dict[str, Any],
    *,
    settings: Settings,
    now: datetime | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    from foresight_x.calendar_agent.store import list_events as cal_list_events

    current = now or datetime.now(timezone.utc)
    range_name = str(args.get("range") or "").strip().lower()
    query = str(args.get("query") or "").strip()
    start, end, label = _calendar_range_bounds(range_name or query, now=current)
    q_tokens = _tokens(query)
    hits: list[dict[str, Any]] = []
    for ev in cal_list_events(settings, settings.foresight_user_id):
        st = _parse_event_dt(ev.start)
        en = _parse_event_dt(ev.end)
        if st is None or en is None:
            continue
        st_local = st.astimezone()
        en_local = en.astimezone()
        if start is not None and end is not None and not (st_local < end and en_local > start):
            continue
        blob = " ".join([ev.title, ev.description or "", ev.source, ev.decision_id or ""])
        score = _score_text(blob, q_tokens)
        if q_tokens and score <= 0 and range_name == "all":
            continue
        hits.append(
            {
                "id": ev.id,
                "title": ev.title,
                "start": ev.start,
                "end": ev.end,
                "source": ev.source,
                "locked": ev.locked,
                "description": ev.description or "",
                "time_label": _event_time_phrase(st_local, en_local),
                "score": score,
            }
        )
    hits.sort(key=lambda h: (_parse_event_dt(str(h.get("start") or "")) or current).timestamp())
    return (
        {
            "ok": True,
            "query": query,
            "range": label,
            "events": hits[:12],
            "total": len(hits),
        },
        {
            "type": "show_calendar_result",
            "route": "",
            "payload": {"events": hits[:12], "range": label},
        },
    )


def tool_create_calendar_draft(
    args: dict[str, Any],
    *,
    transcript: str = "",
    settings: Settings | None = None,
    user_timezone: str = "UTC",
    now: datetime | None = None,
    context: SlimeVoiceContext | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    from foresight_x.calendar_agent.calendar_service import build_draft_from_intent
    from foresight_x.calendar_agent.schemas import CalendarIntent
    from foresight_x.calendar_agent.store import list_events as cal_list_events
    from foresight_x.voice.calendar_command_parser import merge_calendar_args_with_transcript

    s = settings or load_settings()
    uid = s.foresight_user_id
    merged = merge_calendar_args_with_transcript(args, transcript, settings=s)
    ruc = (context.recent_ui_context if context else {}) or {}
    did = ruc.get("decision_id")
    tid = context.thread_id if context else None
    intent = CalendarIntent(
        intent_type="create_event",
        title=merged.title,
        description=merged.description,
        date_hint=merged.date_hint,
        time_hint=merged.time_hint,
        duration_minutes=merged.duration_minutes,
        source="slime_voice",
        thread_id=str(tid) if tid else None,
        decision_id=str(did).strip() if did else None,
        confidence=float(merged.confidence),
    )
    existing = cal_list_events(s, uid)
    draft = build_draft_from_intent(
        intent,
        settings=s,
        user_id=uid,
        existing_events=existing,
        user_timezone=user_timezone,
        now=now or datetime.now(timezone.utc),
    )
    pe0 = draft.proposed_events[0] if draft.proposed_events else None
    meta = (pe0.metadata if pe0 else {}) or {}
    resolved_payload = {
        "title": pe0.title if pe0 else merged.title,
        "start_iso": pe0.start if pe0 else "",
        "end_iso": pe0.end if pe0 else "",
        "duration_minutes": merged.duration_minutes or 30,
        "display_summary": str(meta.get("display_summary") or draft.explanation[:200]),
        "requires_confirmation": True,
        "ambiguity_note": pe0.description if pe0 else None,
        "timezone": str(meta.get("timezone") or user_timezone),
    }
    tr: dict[str, Any] = {
        "ok": True,
        "draft": merged.model_dump(mode="json"),
        "calendar_agent_draft": draft.model_dump(mode="json"),
        "resolved": resolved_payload,
        "draft_id": draft.draft_id,
        "requires_confirmation": True,
    }
    fe: dict[str, Any] = {
        "type": "calendar_draft_confirm",
        "route": "",
        "payload": {
            "resolved": resolved_payload,
            "draft_id": draft.draft_id,
            "calendar_agent_draft": draft.model_dump(mode="json"),
            "conflicts": [c.model_dump(mode="json") for c in draft.conflicts],
        },
    }
    return tr, fe


def tool_schedule_decision_plan(
    args: dict[str, Any],
    *,
    context: SlimeVoiceContext,
    settings: Settings,
) -> tuple[dict[str, Any], dict[str, Any]]:
    from foresight_x.calendar_agent.calendar_service import draft_from_report
    from foresight_x.calendar_agent.store import list_events as cal_list_events
    from foresight_x.harness.trace import load_decision_trace

    ruc = context.recent_ui_context or {}
    did = str(args.get("decision_id") or ruc.get("decision_id") or "").strip()
    if not did:
        return (
            {"ok": False, "error": "missing_decision_id"},
            {"type": "none", "route": "", "payload": {}},
        )
    try:
        trace = load_decision_trace(did, settings=settings)
    except FileNotFoundError:
        return (
            {"ok": False, "error": "trace_not_found"},
            {"type": "none", "route": "", "payload": {}},
        )
    trace_user = str(trace.user_state.active_user_id or "").strip()
    uid = settings.foresight_user_id
    visible = trace_user == uid if trace_user else uid == "demo_user"
    if not visible:
        return (
            {"ok": False, "error": "trace_not_found"},
            {"type": "none", "route": "", "payload": {}},
        )
    existing = cal_list_events(settings, uid)
    draft = draft_from_report(
        settings=settings,
        user_id=uid,
        decision_id=did,
        thread_id=context.thread_id,
        existing_events=existing,
    )
    tr = {
        "ok": True,
        "draft_id": draft.draft_id,
        "calendar_agent_draft": draft.model_dump(mode="json"),
    }
    tid_q = f"&threadId={context.thread_id}" if context.thread_id else ""
    fe = {
        "type": "show_calendar_draft",
        "route": f"/execution/{did}?from=slime{tid_q}",
        "payload": {
            "decision_id": did,
            "draft_id": draft.draft_id,
            "draft": draft.model_dump(mode="json"),
        },
    }
    return tr, fe


def tool_open_decision_report_flow(args: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    prompt = str(args.get("decision_prompt") or "").strip()[:2000]
    if not prompt:
        prompt = "I'd like help with a decision."
    prefill = f"I'd like help deciding: {prompt}"
    return {"prefill": prefill}, {
        "type": "navigate",
        "route": "/chat",
        "payload": {"prefill_message": prefill, "open_report_panel": False},
    }


def tool_open_shadow_chat(args: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    prefill = args.get("prefill_message")
    msg = str(prefill).strip()[:2000] if prefill else ""
    return {"prefill": msg or None}, {
        "type": "navigate",
        "route": "/chat",
        "payload": {"prefill_message": msg or None},
    }


def tool_update_slime_profile(
    args: dict[str, Any],
    *,
    route: SlimeVoiceRouteResult,
    settings: Settings,
) -> tuple[dict[str, Any], dict[str, Any]]:
    raw_patch = args.get("patch")
    if not isinstance(raw_patch, dict):
        return {"ok": False, "error": "invalid_patch"}, {"type": "none"}

    existing = load_user_profile(settings)
    base_prof = existing.slime_profile or SlimeProfile(name="Mochi", updated_at="")

    # Build validated partial patch
    patch_in: dict[str, Any] = {}
    nickname_patch_requested = False
    if "name" in raw_patch:
        name = str(raw_patch.get("name") or "").strip()
        if name:
            patch_in["name"] = name[:24]
    if "color_theme" in raw_patch and raw_patch["color_theme"] is not None:
        try:
            patch_in["color_theme"] = SlimeColorTheme(str(raw_patch["color_theme"]).strip().lower())
        except ValueError:
            return {"ok": False, "error": "invalid_color_theme"}, {"type": "none"}
    if raw_patch.get("custom_colors") is not None:
        cc = raw_patch.get("custom_colors")
        if isinstance(cc, dict):
            try:
                patch_in["custom_colors"] = SlimeCustomColors.model_validate(cc)
            except ValidationError:
                return {"ok": False, "error": "invalid_custom_colors"}, {"type": "none"}
    for key, enum_cls in (
        ("personality", SlimePersonality),
        ("shape", SlimeShape),
        ("accessory", SlimeAccessory),
        ("motion", SlimeMotion),
    ):
        if key in raw_patch and raw_patch[key] is not None:
            try:
                patch_in[key] = enum_cls(str(raw_patch[key]).strip().lower())
            except ValueError:
                return {"ok": False, "error": f"invalid_{key}"}, {"type": "none"}

    if raw_patch.get("voice") is not None:
        vraw = raw_patch.get("voice")
        if isinstance(vraw, dict):
            v2 = dict(vraw)
            if "preferredVoiceName" in v2 and "preferred_voice_name" not in v2:
                v2["preferred_voice_name"] = v2.pop("preferredVoiceName")
            base_voice = (base_prof.voice or SlimeVoicePreferences()).model_dump(mode="json")
            overlay: dict[str, Any] = {}
            if "enabled" in v2:
                overlay["enabled"] = bool(v2["enabled"])
            if "rate" in v2:
                overlay["rate"] = v2["rate"]
            if "pitch" in v2:
                overlay["pitch"] = v2["pitch"]
            if "preferred_voice_name" in v2:
                overlay["preferred_voice_name"] = v2["preferred_voice_name"]
            try:
                merged_voice = {**base_voice, **overlay}
                patch_in["voice"] = SlimeVoicePreferences.model_validate(merged_voice)
            except ValidationError:
                return {"ok": False, "error": "invalid_voice"}, {"type": "none"}

    persona_fragments: dict[str, Any] = (
        dict(raw_patch["persona"]) if isinstance(raw_patch.get("persona"), dict) else {}
    )
    for tk in ("user_nickname", "userNickname", "nickname"):
        if tk in raw_patch and raw_patch[tk] is not None:
            val = raw_patch[tk]
            if isinstance(val, str) and val.strip():
                persona_fragments["user_nickname"] = val.strip()
    for tk, pk in (
        ("role_identity", "role_identity"),
        ("roleIdentity", "role_identity"),
        ("role", "role_identity"),
    ):
        if tk in raw_patch and raw_patch[tk] is not None:
            val = raw_patch[tk]
            if isinstance(val, str) and val.strip():
                persona_fragments[pk] = val.strip()

    if isinstance(raw_patch.get("companion_relationship"), str) and raw_patch["companion_relationship"].strip():
        persona_fragments.setdefault(
            "companion_relationship",
            str(raw_patch["companion_relationship"]).strip(),
        )

    raw_persona = persona_fragments if persona_fragments else None
    if isinstance(raw_persona, dict) and raw_persona:
        cur_persona = merge_slime_persona_defaults(base_prof.persona)
        try:
            patch_in["persona"] = merge_persona_patch(cur_persona, raw_persona)
        except ValidationError:
            return {"ok": False, "error": "invalid_persona_patch"}, {"type": "none"}
        if any(k in raw_persona for k in ("user_nickname", "userNickname")):
            nickname_patch_requested = True

    if not patch_in:
        return {"ok": False, "error": "empty_patch"}, {"type": "none"}

    name_needs_confirm = "name" in patch_in and not route.auto_apply_voice_rename
    needs_confirm = (
        route.requires_confirmation
        or name_needs_confirm
        or "custom_colors" in patch_in
        or (nickname_patch_requested and not route.auto_apply_voice_persona)
    )
    if needs_confirm:
        patch_json = _voice_profile_patch_json(patch_in)
        return {"ok": False, "pending_patch": patch_json}, {
            "type": "confirm",
            "route": "",
            "payload": {
                "title": "Update your Slime?",
                "patch": patch_json,
            },
        }

    base = base_prof
    merged = base.model_copy(update=patch_in)
    merged.updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    updated_profile = existing.model_copy(update={"slime_profile": merged})
    save_user_profile(updated_profile, settings=settings)
    return {"ok": True, "slime_profile": merged.model_dump(mode="json")}, {"type": "none", "payload": {}}


def _noop_assistant(route: SlimeVoiceRouteResult, transcript: str) -> str:
    if route.assistant_hint:
        return route.assistant_hint.strip()
    t = (transcript or "").strip().lower()
    # Small talk / greetings when the router used no_op without a spoken hint
    if t and any(
        x in t
        for x in (
            "what's up",
            "whats up",
            "how are you",
            "how's it going",
            "howdy",
            "hi ",
            "hi!",
            "hey ",
            "hey!",
            "hello",
            "good morning",
            "good afternoon",
            "good evening",
            "sup ",
        )
    ):
        pet = "there"
        return f"Hey {pet}! I'm doing great. Want Chat, Diary, Profile, Calendar, or Home? Say it out loud or tap Personalize to change how I look."
    reason = str(route.arguments.get("reason") or "").strip()
    if reason:
        return (
            "I'm here — try asking me to open Chat, Diary, Profile, Calendar, or Home, "
            "or use Personalize to tweak my style."
        )
    return "Okay."


def execute_slime_tool(
    route: SlimeVoiceRouteResult,
    context: SlimeVoiceContext,
    *,
    settings: Settings,
    transcript: str,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Returns tool_result, frontend_action, assistant_text."""
    name = route.tool_name
    args = dict(route.arguments or {})

    if name == "no_op":
        text = _noop_assistant(route, transcript)
        text = _persona_spoken(text, tool_name="no_op", transcript=transcript, settings=settings)
        return {"ok": True, "noop": True}, {"type": "none", "route": "", "payload": {}}, text

    if name == "navigate":
        tr, fe = tool_navigate(args)
        path = tr.get("path", "")
        neutral = (
            f"Opening {args.get('route', 'that')}."
            if tr.get("ok")
            else "I couldn't open that page."
        )
        text = _persona_spoken(neutral, tool_name="navigate", transcript=transcript, settings=settings)
        return tr, {"type": fe["type"], "route": fe.get("route", path), "payload": fe.get("payload", {})}, text

    if name == "search_memory":
        tr, fe = tool_search_memory(args, context=context, settings=settings)
        if not str(args.get("query") or "").strip():
            neutral = "What should I search your memory for?"
            text = _persona_spoken(neutral, tool_name="search_memory", transcript=transcript, settings=settings)
            return tr, fe, text
        ev_raw = tr.get("evidence_items") or []
        ev = [MemoryEvidenceItem.model_validate(x) for x in ev_raw]
        q = str(args.get("query") or "").strip() or transcript.strip()
        eff, raw_persona = _slime_voice_persona_bundle(settings)
        synth = synthesize_memory_answer(
            q,
            ev,
            context,
            settings=settings,
            slime_persona=raw_persona,
            slime_name=eff.name,
            user_ref=eff.user_nickname_for_address,
            slime_profile_saved=eff.profile_saved,
            effective=eff,
        )
        tr_out: dict[str, Any] = {
            **tr,
            "synthesis_confidence": synth.confidence,
            "used_sources": synth.used_sources,
            "should_show_evidence_drawer": synth.should_show_evidence_drawer,
        }
        return tr_out, {"type": fe["type"], "route": "", "payload": fe.get("payload", {})}, synth.assistant_text

    if name == "search_calendar":
        tr, fe = tool_search_calendar(args, settings=settings)
        events = tr.get("events") if isinstance(tr, dict) else []
        if not isinstance(events, list) or not events:
            neutral = f"I don't see anything on {tr.get('range', 'your calendar')}."
        else:
            parts = []
            for ev in events[:4]:
                parts.append(f"{ev.get('title', 'Event')} at {ev.get('time_label', '')}".strip())
            more = int(tr.get("total") or len(events)) - len(parts)
            tail = f" There are {more} more." if more > 0 else ""
            neutral = f"On {tr.get('range', 'your calendar')}, I found: " + "; ".join(parts) + "." + tail
        text = _persona_spoken(neutral, tool_name="search_calendar", transcript=transcript, settings=settings)
        return tr, {"type": fe["type"], "route": "", "payload": fe.get("payload", {})}, text

    if name == "create_calendar_draft":
        tz = str(context.recent_ui_context.get("timezone") or "UTC")
        tr, fe = tool_create_calendar_draft(
            args,
            transcript=transcript,
            settings=settings,
            user_timezone=tz,
            context=context,
        )
        r = tr.get("resolved") or {}
        disp = str(r.get("display_summary") or "")
        title = str(r.get("title") or "Calendar block")
        neutral = f"I can add this to your calendar: {title}, {disp}. Confirm below to save it."
        text = _persona_spoken(neutral, tool_name="create_calendar_draft", transcript=transcript, settings=settings)
        return tr, {"type": fe["type"], "route": "", "payload": fe.get("payload", {})}, text

    if name == "schedule_decision_plan":
        tr, fe = tool_schedule_decision_plan(args, context=context, settings=settings)
        if not tr.get("ok") and str(tr.get("error") or "") == "missing_decision_id":
            tz = str(context.recent_ui_context.get("timezone") or "UTC")
            tr2, fe2 = tool_create_calendar_draft(
                {},
                transcript=transcript,
                settings=settings,
                user_timezone=tz,
                context=context,
            )
            if tr2.get("ok"):
                r = tr2.get("resolved") or {}
                disp = str(r.get("display_summary") or "")
                title = str(r.get("title") or "Calendar block")
                neutral = f"I can add this to your calendar: {title}, {disp}. Confirm below to save it."
                text = _persona_spoken(neutral, tool_name="create_calendar_draft", transcript=transcript, settings=settings)
                return tr2, fe2, text
        if not tr.get("ok"):
            neutral = "I need a decision report ID to pull its execution plan — open a report on the planner, or describe what to schedule and I'll draft calendar blocks."
            text = _persona_spoken(neutral, tool_name="schedule_decision_plan", transcript=transcript, settings=settings)
            return tr, fe, text
        n = len((tr.get("calendar_agent_draft") or {}).get("proposed_events") or [])
        neutral = f"I drafted {n} calendar block(s) from your report. Open the planner to review and confirm."
        text = _persona_spoken(neutral, tool_name="schedule_decision_plan", transcript=transcript, settings=settings)
        return tr, fe, text

    if name == "open_decision_report_flow":
        tr, fe = tool_open_decision_report_flow(args)
        neutral = "Opening Shadow Chat with your decision prompt."
        text = _persona_spoken(neutral, tool_name="open_decision_report_flow", transcript=transcript, settings=settings)
        return tr, {"type": fe["type"], "route": fe["route"], "payload": fe.get("payload", {})}, text

    if name == "open_shadow_chat":
        tr, fe = tool_open_shadow_chat(args)
        neutral = "Opening Shadow Chat."
        text = _persona_spoken(neutral, tool_name="open_shadow_chat", transcript=transcript, settings=settings)
        return tr, {"type": fe["type"], "route": fe["route"], "payload": fe.get("payload", {})}, text

    if name == "update_slime_profile":
        tr, fe = tool_update_slime_profile(args, route=route, settings=settings)
        if fe.get("type") == "confirm":
            neutral = "Should I update your Slime like that? Tap confirm to save."
            text = _persona_spoken(neutral, tool_name="update_slime_profile", transcript=transcript, settings=settings)
            return tr, {"type": "confirm", "route": "", "payload": fe.get("payload", {})}, text
        if tr.get("ok"):
            neutral = "Updated your Slime profile."
            text = _persona_spoken(neutral, tool_name="update_slime_profile", transcript=transcript, settings=settings)
            return tr, {"type": "slime_profile_refresh", "route": "", "payload": {}}, text
        err = str(tr.get("error") or "")
        if err in ("empty_patch", "invalid_patch", "invalid_voice", "invalid_persona_patch"):
            from foresight_x.voice.slime_profile_nl import try_apply_slime_profile_from_chat_message

            applied, nl_reply = try_apply_slime_profile_from_chat_message(transcript, settings=settings)
            if applied and nl_reply:
                return (
                    {"ok": True, "nl_patch_fallback": True},
                    {"type": "slime_profile_refresh", "route": "", "payload": {}},
                    nl_reply[:1200],
                )
        neutral = "I couldn't apply that Slime change."
        text = _persona_spoken(neutral, tool_name="update_slime_profile", transcript=transcript, settings=settings)
        return tr, {"type": "none", "route": "", "payload": {}}, text

    neutral = "I could not run that action."
    text = _persona_spoken(neutral, tool_name="unknown", transcript=transcript, settings=settings)
    return {"ok": False, "error": "unknown_tool"}, {"type": "none", "route": "", "payload": {}}, text

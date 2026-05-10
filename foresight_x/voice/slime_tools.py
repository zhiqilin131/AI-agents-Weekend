"""Validated Slime voice tool execution (server-side)."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import ValidationError

from foresight_x.chat.thread_store import list_threads, load_thread
from foresight_x.config import Settings
from foresight_x.harness.trace_index import list_traces
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
    return {t.lower() for t in re.findall(r"[a-zA-Z0-9']{3,}", q) if t}


def _score_text(text: str, tokens: set[str]) -> float:
    if not text or not tokens:
        return 0.0
    low = text.lower()
    hits = sum(1 for t in tokens if t in low)
    return hits / max(len(tokens), 1)


def _search_profile_and_memory(profile: UserProfile, query: str, tokens: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if profile.about_me and _score_text(profile.about_me, tokens) > 0:
        out.append({"kind": "about_me", "text": profile.about_me[:400], "id": None})
    for pl in profile.priority_lines or []:
        text = getattr(pl, "text", None) or str(pl)
        if _score_text(text, tokens) > 0:
            out.append({"kind": "priority_line", "text": text[:400], "id": getattr(pl, "id", None)})
    for f in profile.memory_facts or []:
        text = getattr(f, "text", None) or str(f)
        if _score_text(text, tokens) > 0:
            fid = getattr(f, "id", None)
            out.append({"kind": "memory_fact", "text": text[:400], "id": fid})
    return out[:12]


def _search_chat_history(settings: Settings, query: str, tokens: set[str], thread_id: str | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    uid = settings.foresight_user_id

    if thread_id:
        t = load_thread(thread_id, user_id=uid)
        msgs = t.get("messages") or []
        ws = str(t.get("working_summary") or "")
        if ws and _score_text(ws, tokens) > 0:
            out.append({"kind": "thread_summary", "thread_id": thread_id, "text": ws[:500]})
        for m in msgs:
            if str(m.get("role")) != "user":
                continue
            c = str(m.get("content") or "")
            if _score_text(c, tokens) > 0:
                out.append(
                    {
                        "kind": "chat_message",
                        "thread_id": thread_id,
                        "message_id": m.get("id"),
                        "text": c[:500],
                    }
                )
        return out[:15]

    metas = list_threads(user_id=uid)[:25]
    for meta in metas:
        tid = str(meta.get("thread_id") or "")
        if not tid:
            continue
        t = load_thread(tid, user_id=uid)
        ws = str(t.get("working_summary") or "")
        if ws and _score_text(ws, tokens) > 0:
            out.append({"kind": "thread_summary", "thread_id": tid, "text": ws[:400]})
        for m in (t.get("messages") or [])[-40:]:
            if str(m.get("role")) != "user":
                continue
            c = str(m.get("content") or "")
            if _score_text(c, tokens) > 0:
                out.append(
                    {
                        "kind": "chat_message",
                        "thread_id": tid,
                        "message_id": m.get("id"),
                        "text": c[:400],
                    }
                )
        if len(out) >= 18:
            break
    return out[:18]


def _search_decision_reports(settings: Settings, query: str, tokens: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in list_traces(settings=settings)[:40]:
        preview = f"{item.preview} {item.decision_type}"
        if _score_text(preview, tokens) > 0:
            out.append(
                {
                    "kind": "decision_trace",
                    "decision_id": item.decision_id,
                    "text": preview[:300],
                    "timestamp": item.timestamp,
                }
            )
    return out[:12]


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

    # de-dupe by text prefix
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for h in hits:
        key = (h.get("text") or "")[:80]
        if key in seen:
            continue
        seen.add(key)
        unique.append(h)

    if not unique:
        return (
            {
                "hits": [],
                "evidence_items": [],
                "summary": "",
            },
            {
                "type": "show_memory_result",
                "payload": {"evidence_items": [], "display_mode": "particles"},
            },
        )

    evidence_models = evidence_items_from_hits(unique[:10])
    evidence_items = [e.model_dump(mode="json") for e in evidence_models]
    return (
        {
            "hits": unique[:10],
            "evidence_items": evidence_items,
            "summary": "",
        },
        {
            "type": "show_memory_result",
            "payload": {
                "evidence_items": evidence_items,
                "display_mode": "particles",
            },
        },
    )


def tool_navigate(args: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    route = str(args.get("route") or "").strip().lower().replace("-", "_").replace(" ", "_")
    if route not in ROUTE_TO_PATH:
        return {"ok": False, "error": "invalid_route"}, {"type": "none"}
    path = ROUTE_TO_PATH[route]
    return {"ok": True, "route": route, "path": path}, {"type": "navigate", "route": path, "payload": {}}


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

    needs_confirm = (
        route.requires_confirmation
        or "name" in patch_in
        or "custom_colors" in patch_in
        or nickname_patch_requested
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
        if not tr.get("ok"):
            neutral = "I need an open decision report to schedule — open a report first, or say which decision ID."
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

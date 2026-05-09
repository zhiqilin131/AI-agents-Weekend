"""Validated Slime voice tool execution (server-side)."""

from __future__ import annotations

import re
from datetime import datetime, timezone
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
    SlimeProfile,
    SlimeShape,
    UserProfile,
)
from foresight_x.voice.slime_memory_synthesis import MemoryEvidenceItem, evidence_items_from_hits, synthesize_memory_answer
from foresight_x.voice.slime_voice_router import SlimeVoiceContext, SlimeVoiceRouteResult

ROUTE_TO_PATH: dict[str, str] = {
    "home": "/",
    "profile": "/profile",
    "shadow_chat": "/chat",
    "execution_calendar": "/execution",
    "history": "/history",
    "settings": "/personalize",
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
    route = str(args.get("route") or "").strip().lower()
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
) -> tuple[dict[str, Any], dict[str, Any]]:
    from foresight_x.calendar.datetime_resolver import resolve_calendar_draft
    from foresight_x.voice.calendar_command_parser import merge_calendar_args_with_transcript

    merged = merge_calendar_args_with_transcript(args, transcript, settings=settings)
    resolved = resolve_calendar_draft(
        merged,
        user_timezone=user_timezone,
        now=now or datetime.now(timezone.utc),
    )
    tr: dict[str, Any] = {
        "ok": True,
        "draft": merged.model_dump(mode="json"),
        "resolved": resolved.model_dump(mode="json"),
        "requires_confirmation": True,
    }
    fe: dict[str, Any] = {
        "type": "calendar_draft_confirm",
        "route": "",
        "payload": {"resolved": resolved.model_dump(mode="json")},
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

    # Build validated partial patch
    patch_in: dict[str, Any] = {}
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

    if not patch_in:
        return {"ok": False, "error": "empty_patch"}, {"type": "none"}

    needs_confirm = route.requires_confirmation or "name" in patch_in or "custom_colors" in patch_in
    if needs_confirm:
        return {"ok": False, "pending_patch": patch_in}, {
            "type": "confirm",
            "route": "",
            "payload": {
                "title": "Update your Slime?",
                "patch": {k: (v.model_dump(mode="json") if hasattr(v, "model_dump") else v) for k, v in patch_in.items()},
            },
        }

    existing = load_user_profile(settings)
    base = existing.slime_profile or SlimeProfile(name="Mochi", updated_at="")
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
        return f"Hey {pet}! I'm doing great. Want to open Chat, your profile, or the calendar? Or tap Personalize to change how I look."
    reason = str(route.arguments.get("reason") or "").strip()
    if reason:
        return (
            "I'm here — try asking me to open Chat, Home, or your calendar, "
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
        return {"ok": True, "noop": True}, {"type": "none", "route": "", "payload": {}}, text

    if name == "navigate":
        tr, fe = tool_navigate(args)
        path = tr.get("path", "")
        return tr, {"type": fe["type"], "route": fe.get("route", path), "payload": fe.get("payload", {})}, (
            f"Opening {args.get('route', 'that')}."
            if tr.get("ok")
            else "I couldn't open that page."
        )

    if name == "search_memory":
        tr, fe = tool_search_memory(args, context=context, settings=settings)
        if not str(args.get("query") or "").strip():
            return tr, fe, "What should I search your memory for?"
        ev_raw = tr.get("evidence_items") or []
        ev = [MemoryEvidenceItem.model_validate(x) for x in ev_raw]
        q = str(args.get("query") or "").strip() or transcript.strip()
        synth = synthesize_memory_answer(q, ev, context, settings=settings)
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
        )
        r = tr.get("resolved") or {}
        disp = str(r.get("display_summary") or "")
        title = str(r.get("title") or "Calendar block")
        text = f"I can add this to your calendar: {title}, {disp}. Confirm below to save it."
        return tr, {"type": fe["type"], "route": "", "payload": fe.get("payload", {})}, text

    if name == "open_decision_report_flow":
        tr, fe = tool_open_decision_report_flow(args)
        return tr, {"type": fe["type"], "route": fe["route"], "payload": fe.get("payload", {})}, (
            "Opening Shadow Chat with your decision prompt."
        )

    if name == "open_shadow_chat":
        tr, fe = tool_open_shadow_chat(args)
        return tr, {"type": fe["type"], "route": fe["route"], "payload": fe.get("payload", {})}, "Opening Shadow Chat."

    if name == "update_slime_profile":
        tr, fe = tool_update_slime_profile(args, route=route, settings=settings)
        if fe.get("type") == "confirm":
            return tr, {"type": "confirm", "route": "", "payload": fe.get("payload", {})}, (
                "Should I update your Slime like that? Tap confirm to save."
            )
        if tr.get("ok"):
            return tr, {"type": "none", "route": "", "payload": {}}, "Updated your Slime profile."
        return tr, {"type": "none", "route": "", "payload": {}}, "I couldn't apply that Slime change."

    return {"ok": False, "error": "unknown_tool"}, {"type": "none", "route": "", "payload": {}}, (
        "I could not run that action."
    )

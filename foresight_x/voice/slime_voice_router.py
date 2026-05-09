"""GPT-4o-mini structured routing for Slime voice commands."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.config import Settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)


class SlimeVoiceContext(BaseModel):
    user_id: str
    current_route: str | None = None
    thread_id: str | None = None
    slime_profile: dict[str, Any] = Field(default_factory=dict)
    recent_ui_context: dict[str, Any] = Field(default_factory=dict)


class SlimeVoiceRouteResult(BaseModel):
    intent: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    requires_confirmation: bool = False
    assistant_hint: str | None = None


class _LLMRoute(BaseModel):
    tool_name: Literal[
        "navigate",
        "search_memory",
        "create_calendar_draft",
        "open_decision_report_flow",
        "update_slime_profile",
        "open_shadow_chat",
        "no_op",
    ]
    arguments: dict[str, Any] = Field(default_factory=dict)
    requires_confirmation: bool = False
    assistant_hint: str | None = None


_ROUTER_PROMPT = """You route user voice commands for a personal AI companion (Slime).
Return ONLY valid structured fields matching the schema (tool_name, arguments, requires_confirmation, assistant_hint).

Allowed tools:
1) navigate — arguments: {{"route": "home|profile|shadow_chat|execution_calendar|history|settings"}}
2) search_memory — arguments: {{"query": "<string>", "scope": "profile|chat_history|decision_reports|all"}}
3) create_calendar_draft — arguments: {{"title": "<string>", "duration_minutes": <number|null>, "date_hint": "<string|null>", "time_hint": "<string|null>", "description": "<string|null>"}}
4) open_decision_report_flow — arguments: {{"decision_prompt": "<string>"}}
5) update_slime_profile — arguments: {{"patch": {{ ... partial slime fields: name, color_theme, personality, shape, accessory, motion, custom_colors }}}}
6) open_shadow_chat — arguments: {{"prefill_message": "<string or null>"}}
7) no_op — arguments: {{"reason": "<string>"}} — use for chit-chat, unsafe, or unknown commands. **Always set assistant_hint** to a short, friendly line you would say out loud (1–2 sentences), e.g. greetings get a warm reply.

Rules:
- If the user is asking what they should do, whether to accept an offer, or for help deciding (including Chinese equivalents like "我该怎么办"), use **no_op** with a thoughtful assistant_hint — do **not** use open_decision_report_flow. The conversational pipeline will offer Decision Mode with explicit confirmation.
- Unknown or unsafe requests → no_op with a short reason **and** a helpful assistant_hint.
- Navigation: use navigate or open_shadow_chat; never invent URLs.
- Memory: use search_memory with a concrete query; scope "all" when user asks generally about what they said.
- Calendar: create_calendar_draft for new blocks ("add 30 minutes Saturday morning", "gym tomorrow at 9", "review next Friday"). Include time_hint when user says morning/afternoon/evening or a clock time. The app will ask for confirmation before saving.
- Profile appearance/name: update_slime_profile with requires_confirmation=true unless the user was very explicit and the change is minor (still confirm for renames and custom colors).
- Do not claim to have executed actions; tools + frontend will do that.
- Keep assistant_hint a short optional line for tone (may be ignored).

User transcript:
{transcript}

Context JSON:
{context_json}
"""


def route_slime_voice_command(
    transcript: str,
    user_context: SlimeVoiceContext,
    *,
    settings: Settings,
) -> SlimeVoiceRouteResult:
    if not (settings.openai_api_key or "").strip():
        return SlimeVoiceRouteResult(
            intent="unknown",
            tool_name="no_op",
            arguments={"reason": "missing_openai_key"},
            requires_confirmation=False,
            assistant_hint="I need the server to have OPENAI_API_KEY configured for intent routing.",
        )

    llm = build_openai_llm(settings, temperature=0.1)
    ctx_json = json.dumps(user_context.model_dump(mode="json"), ensure_ascii=False)[:12000]
    prompt = _ROUTER_PROMPT.format(transcript=transcript.strip()[:4000], context_json=ctx_json)
    t0 = time.perf_counter()
    try:
        raw = structured_predict(llm, _LLMRoute, prompt)
    except Exception as e:
        _log.warning("slime voice route LLM failed: %s", e)
        return SlimeVoiceRouteResult(
            intent="unknown",
            tool_name="no_op",
            arguments={"reason": "router_error"},
            requires_confirmation=False,
            assistant_hint="I could not parse that request. Try rephrasing briefly.",
        )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    _log.info("slime voice route_llm_ms=%.0f tool=%s", elapsed_ms, raw.tool_name)

    intent_map = {
        "navigate": "navigate",
        "search_memory": "memory_search",
        "create_calendar_draft": "calendar_create",
        "open_decision_report_flow": "decision_report",
        "update_slime_profile": "profile_update",
        "open_shadow_chat": "chat",
        "no_op": "unknown",
    }
    return SlimeVoiceRouteResult(
        intent=intent_map.get(raw.tool_name, "unknown"),
        tool_name=raw.tool_name,
        arguments=dict(raw.arguments or {}),
        requires_confirmation=bool(raw.requires_confirmation),
        assistant_hint=raw.assistant_hint,
    )

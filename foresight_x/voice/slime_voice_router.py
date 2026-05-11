"""GPT-4o-mini structured routing for Slime voice commands."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.config import Settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.structured_predict import structured_predict
from foresight_x.voice.slime_text_safety import is_safe_slime_display_name

_log = logging.getLogger(__name__)

_ROUTER_SLIME_KEYS = frozenset({"name", "color_theme", "shape"})

_QUICK_COLOR_THEME_TOKENS = frozenset({"aurora", "violet", "mint", "sunset", "lime", "silver"})

_RENAME_VOICE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)\b(?:from\s+now\s+on\s+)?your\s+name\s+is\s+(.+)$"),
    re.compile(r"(?i)^(?:i'?ll|i\s+will)\s+call\s+you\s+(.+)$"),
    re.compile(r"(?i)^let'?s\s+call\s+you\s+(.+)$"),
    re.compile(r"(?i)^rename\s+(?:yourself|you)\s+to\s+(.+)$"),
    re.compile(r"(?i)^you(?:'re|\s+are)\s+(?:now\s+)?called\s+(.+)$"),
    re.compile(r"(?i)^i\s+(?:want\s+to\s+)?name\s+you\s+(.+)$"),
    # Chinese: explicit rename phrasing only (avoid matching 你叫什么).
    re.compile(r"^(?:以后\s*)?你就叫\s*(.+)$"),
    re.compile(r"^我叫你\s*(.+)$"),
)


def _clean_extracted_slime_voice_name(fragment: str) -> str:
    s = (fragment or "").strip()
    s = s.strip(" '\"「」『』\"'“”‘’")
    low = s.lower()
    for stop in (
        " from now",
        " starting",
        " okay",
        " ok",
        " thanks",
        " thank you",
        " please",
        " now",
        " today",
    ):
        i = low.find(stop)
        if i > 0:
            s = s[:i].strip()
            low = s.lower()
    s = s.strip(".,;:!?…。！？")
    return s[:24].strip()


def _try_slime_rename_voice_patch(transcript: str) -> dict[str, Any] | None:
    """
    Deterministic slime rename so Buddy works without the LLM router and common phrases still apply.
    Skips user-nickname phrases (call me … / 叫我…).
    """
    raw = (transcript or "").strip()
    if not raw or len(raw) > 200:
        return None
    low = raw.lower()
    if any(
        b in low
        for b in (
            "call me ",
            "refer to me as",
            "叫我",
            "称呼我",
            "my name is",
        )
    ):
        return None
    for rx in _RENAME_VOICE_PATTERNS:
        m = rx.search(raw.strip())
        if not m:
            continue
        name = _clean_extracted_slime_voice_name(m.group(1))
        if not name or not is_safe_slime_display_name(name):
            continue
        return {"patch": {"name": name}}
    return None


def _quick_slime_color_theme_patch(transcript: str) -> dict[str, Any] | None:
    """
    Deterministic routing for short spoken theme picks when the LLM router is flaky.
    Avoid stealing nickname/rename or meta questions (e.g. 'call me Mint').
    """
    raw = (transcript or "").strip()
    if not raw or len(raw) > 96:
        return None
    low = raw.lower()
    blockers = (
        "call me ",
        "refer to me as",
        "叫我",
        "称呼我",
        "rename yourself",
        "rename you",
        "your name is",
        "what color",
        "which color",
        "who are you",
    )
    if any(b in low for b in blockers):
        return None
    if _explicit_report_schedule_intent(transcript):
        return None

    parts = low.split()
    if len(parts) == 1 and parts[0] in _QUICK_COLOR_THEME_TOKENS:
        return {"patch": {"color_theme": parts[0]}}
    if len(parts) == 2 and parts[0] in ("go", "use", "try", "pick", "choose") and parts[1] in _QUICK_COLOR_THEME_TOKENS:
        return {"patch": {"color_theme": parts[1]}}
    if len(parts) == 2 and parts[1] == "theme" and parts[0] in _QUICK_COLOR_THEME_TOKENS:
        return {"patch": {"color_theme": parts[0]}}
    if len(parts) >= 3 and parts[0] in ("switch", "change") and parts[1] == "to" and parts[2] in _QUICK_COLOR_THEME_TOKENS:
        return {"patch": {"color_theme": parts[2]}}
    return None


def _explicit_report_schedule_intent(transcript: str) -> bool:
    """
    True when the user is clearly asking to schedule items **from an existing decision report**
    (report-linked wording), so we should not silently reinterpret as a generic calendar draft.
    """
    t = (transcript or "").lower()
    needles = (
        "from my decision report",
        "from the decision report",
        "from my report",
        "from that report",
        "from the report",
        "report next step",
        "next steps from the report",
        "next actions from the report",
        "schedule my report",
        "schedule the report",
        "report plan",
        "report onto",
        "report on the calendar",
        "report to the calendar",
        "decision report onto",
        "trace ",
    )
    return any(n in t for n in needles)


def _routing_context_json(ctx: SlimeVoiceContext) -> str:
    """Omit most persona/voice text from tool-router context — keep fields that disambiguate name vs user address."""
    d = ctx.model_dump(mode="json")
    sp = d.get("slime_profile")
    if isinstance(sp, dict):
        slim: dict[str, Any] = {k: v for k, v in sp.items() if k in _ROUTER_SLIME_KEYS}
        persona = sp.get("persona")
        if isinstance(persona, dict):
            nick = persona.get("user_nickname")
            if nick is None:
                nick = persona.get("userNickname")
            if nick is not None and str(nick).strip():
                slim["user_nickname_saved"] = str(nick).strip()[:48]
        d["slime_profile"] = slim
    ruc = d.get("recent_ui_context")
    if isinstance(ruc, dict):
        did = str(ruc.get("decision_id") or ruc.get("active_decision_id") or "").strip()
        tz = ruc.get("timezone")
        hints: dict[str, Any] = {}
        if did:
            hints["decision_id_in_ui_context"] = did[:80]
        if tz:
            hints["timezone"] = str(tz)[:80]
        if hints:
            d["routing_hints"] = hints
    return json.dumps(d, ensure_ascii=False)[:12000]


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
    #: Heuristic ASR slime rename (``_try_slime_rename_voice_patch``) — safe to persist without a second tap.
    auto_apply_voice_rename: bool = False


class _LLMRoute(BaseModel):
    tool_name: Literal[
        "navigate",
        "search_memory",
        "create_calendar_draft",
        "schedule_decision_plan",
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
1) navigate — arguments: {{"route": "<slug>"}} — allowed slugs:
   home, profile (same page as settings/account/user_profile/my_profile), shadow_chat or chat, execution_calendar or calendar or planner,
   history, diary or journal, buddy or slime_buddy, reflect (legacy shadow UI).
2) search_memory — arguments: {{"query": "<string>", "scope": "profile|chat_history|decision_reports|all"}}
3) create_calendar_draft — arguments: {{"title": "<string>", "duration_minutes": <number|null>, "date_hint": "<string|null>", "time_hint": "<string|null>", "description": "<string|null>"}}
   DEFAULT for “add / put / schedule something on my calendar or execution calendar” when the user describes tasks, plans, blocks, or reminders WITHOUT tying them to an existing decision report.
   Put multi-step natural-language plans into **description** when helpful; title can be short (e.g. “Relationship plan”).
4) schedule_decision_plan — arguments: {{"decision_id": "<string|null>"}} — ONLY when scheduling **next_actions / execution plan copied FROM an existing decision report** (user mentions the report, report next steps, or routing_hints.decision_id_in_ui_context is set).
5) open_decision_report_flow — arguments: {{"decision_prompt": "<string>"}}
6) update_slime_profile — arguments: {{"patch": {{ ... partial Slime Studio fields (same as Personalize UI) }}}}
   Top-level patch keys: name, color_theme (aurora|violet|mint|sunset|lime|silver|custom), custom_colors {{primary,secondary,glow}} hex,
   personality (calm|direct|encouraging|analytical|playful|cautious), shape (classic|orb|robot|crystal|ghost),
   accessory (none|glasses|halo|antenna|scarf|spark), motion (subtle|normal|expressive),
   voice {{enabled, rate 0.5-2, pitch 0.5-2, preferred_voice_name optional}}.
   Nested patch.persona (partial): user_nickname, companion_relationship, personality_preset, tone, warmth/humor/directness 0-3,
   reply_length (short|balanced|detailed), role_identity, catchphrases (≤3), donts (≤5).
   You may also set patch.role or patch.role_identity (string) as shorthand for persona.role_identity (same meaning).
   - patch.name = **only** this Slime character's display name (what the companion is called).
   - patch.persona.user_nickname = **only** how this Slime should address/refer to the **human user** (optional nickname/honorific).
   - Example rename Slime: {{"patch": {{"name": "Blob"}}}}
   - Example change how Slime talks to the user: {{"patch": {{"persona": {{"user_nickname": "boss"}}}}}}
   - Example theme + voice: {{"patch": {{"color_theme": "mint", "voice": {{"rate": 0.9}}}}}}
   Context slime_profile may include user_nickname_saved = current saved user address form; patch.name must never duplicate that intent.
7) open_shadow_chat — arguments: {{"prefill_message": "<string or null>"}}
8) no_op — arguments: {{"reason": "<string>"}} — use for chit-chat, unsafe, or unknown commands. **Always set assistant_hint** to a short, friendly line you would say out loud (1–2 sentences), e.g. greetings get a warm reply.

Rules:
- If the user is asking what they should do, whether to accept an offer, or for help deciding (including Chinese equivalents like "我该怎么办"), use **no_op** with a thoughtful assistant_hint — do **not** use open_decision_report_flow. The conversational pipeline will offer Decision Mode with explicit confirmation.
- Unknown or unsafe requests → no_op with a short reason **and** a helpful assistant_hint.
- Navigation: use navigate or open_shadow_chat; never invent URLs.
  Map user intent: "diary / journal / 日记" → route diary; "profile / my profile / account / 个人资料 / 档案页" → route profile;
  "buddy / slime / this page" → route buddy when they want Slime Buddy home.
- Memory: use search_memory with a concrete query; scope "all" when user asks generally about what they said.
- Calendar (important):
  • **create_calendar_draft** — Use for almost all “add to calendar / execution calendar / planner / schedule a block” requests, including vague “put this plan there” or long spoken plans. Do **not** require a decision report.
  • **schedule_decision_plan** — Use **only** when the user clearly wants events generated **from an existing decision report** (mentions report/next steps from report) **or** routing_hints include decision_id_in_ui_context and they ask to schedule that report’s plan. If no decision_id is available and they did not anchor to a report, prefer **create_calendar_draft**.
  • **open_decision_report_flow** — Only when they want to **start a new** structured decision analysis in chat—not for putting arbitrary plans on the calendar.
  Include time_hint for morning/afternoon/evening or clock times. The app confirms before saving.
- Profile updates: update_slime_profile. Use patch.persona.user_nickname when the user changes what **they** want to be called (e.g. "call me …", "refer to me as …", "叫我…", "称呼我…", "别叫我 master 了"). Use patch.name **only** when they name/rename **the Slime** ("your name is …", "I'll call you Blob", "你就叫…"). Never put the user's requested form of address into patch.name.
- Color / theme: any clear request to change the Slime preset palette → patch.color_theme (aurora|violet|mint|sunset|lime|silver) or custom_colors if they give hex. Short utterances like "mint", "switch to violet", "change color to sunset", "换成薄荷色" must route here with requires_confirmation=false unless they supply custom hex colors.
- Confirm appearance/safety: requires_confirmation=true unless the user was very explicit and the change is minor (still confirm for Slime renames, user_nickname changes, and custom colors).
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
    rename = _try_slime_rename_voice_patch(transcript.strip())
    if rename is not None:
        return SlimeVoiceRouteResult(
            intent="profile_update",
            tool_name="update_slime_profile",
            arguments=rename,
            requires_confirmation=False,
            assistant_hint=None,
            auto_apply_voice_rename=True,
        )

    quick = _quick_slime_color_theme_patch(transcript.strip())
    if quick is not None:
        return SlimeVoiceRouteResult(
            intent="profile_update",
            tool_name="update_slime_profile",
            arguments=quick,
            requires_confirmation=False,
            assistant_hint=None,
        )

    if not (settings.openai_api_key or "").strip():
        return SlimeVoiceRouteResult(
            intent="unknown",
            tool_name="no_op",
            arguments={"reason": "missing_openai_key"},
            requires_confirmation=False,
            assistant_hint="I need the server to have OPENAI_API_KEY configured for intent routing.",
        )

    llm = build_openai_llm(settings, temperature=0.1)
    ctx_json = _routing_context_json(user_context)
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

    if raw.tool_name == "schedule_decision_plan":
        args_d = dict(raw.arguments or {})
        ruc = user_context.recent_ui_context or {}
        arg_did = str(args_d.get("decision_id") or "").strip()
        ctx_did = str(ruc.get("decision_id") or ruc.get("active_decision_id") or "").strip()
        if not arg_did and not ctx_did and not _explicit_report_schedule_intent(transcript):
            raw = raw.model_copy(
                update={
                    "tool_name": "create_calendar_draft",
                    "arguments": {},
                }
            )
            _log.info("slime voice reroute schedule_decision_plan → create_calendar_draft (no report anchor)")

    intent_map = {
        "navigate": "navigate",
        "search_memory": "memory_search",
        "create_calendar_draft": "calendar_create",
        "schedule_decision_plan": "calendar_plan",
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

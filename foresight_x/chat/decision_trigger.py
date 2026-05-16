from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
from typing import Any

_ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"
_SOFT_SIGNAL_TTL_MINUTES = 20
_DECISION_DISMISS_COOLDOWN_HOURS = 6

_DECISION_MODE_COMMAND_RE = re.compile(
    r"\b("
    r"start|enter|open|switch(?:\s+to)?|turn\s+on|begin|run|generate|make|create|launch|activate"
    r")\b.*\b("
    r"decision(?:\s+report|\s+mode)?|report(?:\s+mode)?"
    r")\b",
    re.I,
)

_DECISION_MODE_COMMAND_ZH_RE = re.compile(
    r"(进入|开始|开启|切换到|打开|生成|做一个|创建).{0,10}(决策模式|决策报告|decision mode|decision report)",
    re.I,
)

_AFFIRMATIVE_WORDS = {
    "yes",
    "y",
    "yeah",
    "yep",
    "sure",
    "ok",
    "okay",
    "please do",
    "do it",
    "go ahead",
    "sounds good",
    "是",
    "好",
    "好的",
    "对",
    "对的",
    "可以",
    "行",
}

_NEGATIVE_WORDS = {
    "no",
    "n",
    "nope",
    "nah",
    "not now",
    "later",
    "stop",
    "取消",
    "不用",
    "先不用",
    "不要",
    "不用了",
    "暂时不要",
}

_WEAK_DECISION_CUES = ("should", "whether", "or ", "要不要", "该不该", "怎么选", "帮我选")


@dataclass
class DecisionTriggerEvaluation:
    effective_action: str
    should_offer_suggestion: bool = False
    auto_triggered: bool = False
    decision_prompt: str = ""
    reason: str = ""


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.strptime(v, _ISO_FMT).replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _to_iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).strftime(_ISO_FMT)


def _clean_text(text: str) -> str:
    return " ".join(str(text or "").strip().lower().split())


def is_explicit_decision_mode_command(message: str) -> bool:
    text = _clean_text(message)
    if not text:
        return False
    if text in {
        "decision mode",
        "start decision mode",
        "activate decision mode",
        "decision report",
        "generate decision report",
    }:
        return True
    return bool(_DECISION_MODE_COMMAND_RE.search(text) or _DECISION_MODE_COMMAND_ZH_RE.search(text))


def _classify_confirmation_reply(message: str) -> str | None:
    text = _clean_text(message).strip("!?.。，！？ ")
    if not text:
        return None
    if text in _AFFIRMATIVE_WORDS:
        return "yes"
    if text in _NEGATIVE_WORDS:
        return "no"
    if len(text) <= 24:
        if any(word == text for word in _AFFIRMATIVE_WORDS):
            return "yes"
        if any(word == text for word in _NEGATIVE_WORDS):
            return "no"
    return None


def _default_state() -> dict[str, Any]:
    return {
        "pending_confirmation": False,
        "pending_prompt": "",
        "pending_since": "",
        "dismissed_until": "",
        "soft_signal_count": 0,
        "last_signal_at": "",
        "last_trigger_at": "",
        "last_trigger_reason": "",
    }


def _ensure_state(thread: dict[str, Any]) -> dict[str, Any]:
    raw = thread.get("decision_trigger_state")
    state = dict(raw) if isinstance(raw, dict) else {}
    base = _default_state()
    base.update(state)
    thread["decision_trigger_state"] = base
    return base


def _cooldown_active(state: dict[str, Any], *, now: datetime) -> bool:
    until = _parse_iso(str(state.get("dismissed_until") or ""))
    return bool(until and until > now)


def _set_cooldown(state: dict[str, Any], *, now: datetime, hours: int = _DECISION_DISMISS_COOLDOWN_HOURS) -> None:
    state["dismissed_until"] = _to_iso(now + timedelta(hours=hours))


def _clear_decision_suppression(state: dict[str, Any], thread: dict[str, Any]) -> None:
    """Allow a fresh decision offer on the next detected fork (no stale dismiss/cooldown)."""
    state["dismissed_until"] = ""
    ds = thread.setdefault("dismissed_suggestions", {"role_mode": False, "decision_report": False})
    ds["decision_report"] = False


def preview_will_auto_start_decision(thread: dict[str, Any], message: str) -> bool:
    """Only auto-start after the user confirmed a pending offer (e.g. replied yes)."""
    state = _ensure_state(thread)
    if not bool(state.get("pending_confirmation")):
        return False
    return _classify_confirmation_reply(message) == "yes"


def evaluate_decision_trigger(
    *,
    thread: dict[str, Any],
    user_action: str,
    user_message: str,
    intent_label: str,
    intent_confidence: float,
) -> DecisionTriggerEvaluation:
    now = _now_utc()
    state = _ensure_state(thread)
    action = (user_action or "send_message").strip() or "send_message"
    message = (user_message or "").strip()
    decision_prompt = message[:1200] if message else str(state.get("pending_prompt") or "")

    if action == "dismiss_suggestion":
        state["pending_confirmation"] = False
        state["pending_prompt"] = ""
        state["soft_signal_count"] = 0
        return DecisionTriggerEvaluation(effective_action=action)

    if action == "continue_normally":
        state["pending_confirmation"] = False
        state["pending_prompt"] = ""
        return DecisionTriggerEvaluation(effective_action="send_message")

    if action == "generate_decision_report":
        state["pending_confirmation"] = False
        state["pending_prompt"] = ""
        state["dismissed_until"] = ""
        state["last_trigger_at"] = _to_iso(now)
        state["last_trigger_reason"] = "explicit_action"
        return DecisionTriggerEvaluation(
            effective_action=action,
            auto_triggered=False,
            decision_prompt=decision_prompt,
            reason="explicit_action",
        )

    if action != "send_message" or not message:
        return DecisionTriggerEvaluation(effective_action=action)

    if is_explicit_decision_mode_command(message):
        _clear_decision_suppression(state, thread)
        state["pending_confirmation"] = True
        state["pending_prompt"] = decision_prompt
        state["pending_since"] = _to_iso(now)
        state["soft_signal_count"] = 0
        state["last_trigger_reason"] = "hard_command"
        return DecisionTriggerEvaluation(
            effective_action="send_message",
            should_offer_suggestion=True,
            decision_prompt=decision_prompt,
            reason="hard_command",
        )

    if bool(state.get("pending_confirmation")):
        confirm = _classify_confirmation_reply(message)
        if confirm == "yes":
            state["pending_confirmation"] = False
            state["dismissed_until"] = ""
            state["last_trigger_at"] = _to_iso(now)
            state["last_trigger_reason"] = "followup_confirm_yes"
            return DecisionTriggerEvaluation(
                effective_action="generate_decision_report",
                auto_triggered=True,
                decision_prompt=str(state.get("pending_prompt") or decision_prompt),
                reason="followup_confirm_yes",
            )
        if confirm == "no":
            state["pending_confirmation"] = False
            state["pending_prompt"] = ""
            state["soft_signal_count"] = 0
            return DecisionTriggerEvaluation(
                effective_action="send_message",
                should_offer_suggestion=False,
                auto_triggered=False,
                reason="followup_confirm_no",
            )
        refresh_pending = (
            is_explicit_decision_mode_command(message)
            or intent_label == "decision_candidate"
            or any(k in message.lower() for k in _WEAK_DECISION_CUES)
        )
        if refresh_pending:
            _clear_decision_suppression(state, thread)
            state["pending_prompt"] = decision_prompt
            state["pending_since"] = _to_iso(now)
            state["last_trigger_reason"] = "pending_refresh"
            return DecisionTriggerEvaluation(
                effective_action="send_message",
                should_offer_suggestion=True,
                decision_prompt=decision_prompt,
                reason="pending_refresh",
            )

    last_signal_at = _parse_iso(str(state.get("last_signal_at") or ""))
    if last_signal_at and (now - last_signal_at) > timedelta(minutes=_SOFT_SIGNAL_TTL_MINUTES):
        state["soft_signal_count"] = 0

    weak_signal = any(k in message.lower() for k in _WEAK_DECISION_CUES)
    if intent_label == "decision_candidate":
        boost = 2 if intent_confidence >= 0.72 else 1
        state["soft_signal_count"] = min(6, int(state.get("soft_signal_count", 0)) + boost)
        state["last_signal_at"] = _to_iso(now)
    elif weak_signal:
        state["soft_signal_count"] = min(6, int(state.get("soft_signal_count", 0)) + 1)
        state["last_signal_at"] = _to_iso(now)
    else:
        state["soft_signal_count"] = max(0, int(state.get("soft_signal_count", 0)) - 1)

    strong_decision_signal = intent_label == "decision_candidate" and intent_confidence >= 0.68
    if _cooldown_active(state, now=now) and not strong_decision_signal:
        return DecisionTriggerEvaluation(effective_action="send_message", should_offer_suggestion=False)

    should_offer = intent_label == "decision_candidate" and (
        intent_confidence >= 0.68 or int(state.get("soft_signal_count", 0)) >= 1
    )
    if should_offer:
        _clear_decision_suppression(state, thread)
        state["pending_confirmation"] = True
        state["pending_prompt"] = decision_prompt
        state["pending_since"] = _to_iso(now)
        return DecisionTriggerEvaluation(
            effective_action="send_message",
            should_offer_suggestion=True,
            decision_prompt=decision_prompt,
            reason="soft_signal",
        )
    return DecisionTriggerEvaluation(effective_action="send_message")

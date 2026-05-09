"""Recent-thread window + lightweight local-context routing for Shadow Chat."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, TypedDict

_SHADOW_ARTIFACT_TYPES = frozenset({"decision_report_artifact"})


class ChatMessageDict(TypedDict, total=False):
    role: str
    content: str
    metadata: dict[str, Any]


_LOCAL_CONTEXT_EN = (
    "what did i just say",
    "what did i say",
    "what joke",
    "what did i joke",
    "earlier in this chat",
    "earlier in our chat",
    "in this chat",
    "what were we talking about",
    "what did you call me",
    "continue from that",
    "as i said before",
    "you said earlier",
    "remind me what",
    "repeat what",
)

_LOCAL_CONTEXT_ZH = (
    "我刚才说了什么",
    "我刚刚说了什么",
    "我刚刚开什么玩笑",
    "我刚刚开的玩笑",
    "我刚才说什么",
    "开玩笑",
    "玩笑是什么",
    "什么玩笑",
    "前面说的",
    "刚才那个",
    "之前在这个聊天",
    "刚刚聊到哪",
    "聊到哪了",
    "继续刚才",
    "接着说",
    "你刚才叫我",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_recent_thread_context(
    thread_messages: list[dict[str, Any]],
    *,
    max_messages: int = 16,
) -> list[ChatMessageDict]:
    """
    Return the most recent user/assistant turns suitable for the Shadow prompt.
    Drops system rows, empty assistant artifacts, and bulky UI artifacts.
    """
    cap = max(4, min(max_messages, 48))
    rows: list[dict[str, Any]] = []
    for m in thread_messages:
        role = str(m.get("role") or "").strip()
        if role == "system":
            continue
        content = str(m.get("content") or "").strip()
        meta = m.get("metadata") if isinstance(m.get("metadata"), dict) else {}
        m_type = str(meta.get("type") or "").strip()
        if m_type in _SHADOW_ARTIFACT_TYPES:
            continue
        if role == "assistant" and not content:
            continue
        if not content:
            continue
        rows.append({"role": role, "content": content})

    if len(rows) <= cap:
        return rows  # type: ignore[return-value]
    return rows[-cap:]  # type: ignore[return-value]


def format_recent_conversation_section(messages: list[ChatMessageDict | dict[str, Any]]) -> str:
    lines: list[str] = []
    for m in messages:
        role = str(m.get("role") or "").strip()
        content = str(m.get("content") or "").strip()
        if role == "system" or not content:
            continue
        who = "user" if role == "user" else "assistant"
        lines.append(f"{who}: {content}")
    if not lines:
        return "(empty)"
    return "\n".join(lines)


def is_local_context_question(message: str) -> bool:
    """Heuristic: user is asking about this thread, not durable biography."""
    t = " ".join((message or "").lower().split())
    if not t:
        return False
    if any(p in t for p in _LOCAL_CONTEXT_EN):
        return True
    raw = (message or "").strip()
    if any(p in raw for p in _LOCAL_CONTEXT_ZH):
        return True
    # Short follow-ups often reference the immediate exchange.
    if t in {"continue", "go on", "and?", "然后呢", "继续"}:
        return True
    return False


def append_temporary_context_items(
    thread: dict[str, Any],
    items: list[dict[str, Any]],
    *,
    max_items: int = 48,
) -> None:
    """Merge serialized TemporaryContextItem dicts onto thread JSON (mutates thread)."""
    if not items:
        return
    bucket = thread.setdefault("temporary_context", [])
    if not isinstance(bucket, list):
        bucket = []
        thread["temporary_context"] = bucket
    ts = _utc_now()
    for raw in items:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").strip()
        if not text:
            continue
        tid = str(raw.get("id") or "").strip() or str(uuid.uuid4())
        entry = {
            "id": tid,
            "text": text[:900],
            "type": str(raw.get("type") or "current_topic").strip() or "current_topic",
            "created_at": str(raw.get("created_at") or "").strip() or ts,
            "expires_scope": "thread",
            "should_not_profile": bool(raw.get("should_not_profile", True)),
        }
        bucket.append(entry)
    thread["temporary_context"] = bucket[-max_items:]


def format_temporary_context_prompt(thread: dict[str, Any]) -> str:
    raw = thread.get("temporary_context")
    if not isinstance(raw, list) or not raw:
        return "(none)"
    lines: list[str] = []
    for item in raw[-24:]:
        if not isinstance(item, dict):
            continue
        tx = str(item.get("text") or "").strip()
        if not tx:
            continue
        kind = str(item.get("type") or "note").strip()
        lines.append(f"- [{kind}] {tx[:420]}")
    return "\n".join(lines) if lines else "(none)"

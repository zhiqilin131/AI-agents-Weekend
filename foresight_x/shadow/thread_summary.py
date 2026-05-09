"""Rolling thread summary — conversational coherence, not durable profile."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.structured_predict import structured_predict


class ThreadWorkingSummaryLLM(BaseModel):
    working_summary: str = Field(
        max_length=2400,
        description=(
            "Compact summary for THIS chat thread only. Mention jokes/temporary names as playful/thread-local. "
            "State current topic and unresolved threads. Never treat playful names as real identity."
        ),
    )


_SUMMARY_PROMPT = """You maintain a rolling WORKING SUMMARY for one chat thread (not long-term user profile).

Rules:
- Preserve local coherence: jokes, temporary names, roleplay setups, current topic, unanswered questions.
- If the user jokingly gave a fake name, write explicitly that it looks playful and must NOT be treated as real identity.
- Do NOT invent facts beyond the transcript.
- Prefer 5–10 short bullet sentences or one compact paragraph (max ~220 words).

Previous summary (may be empty):
---
{prev}
---

Recent conversation:
---
{recent}
---

Return JSON field working_summary only.
"""


def update_thread_working_summary(
    thread: dict[str, Any],
    recent_messages: list[dict[str, Any]],
    *,
    settings: Any,
) -> str:
    """
    Refresh ``thread["working_summary"]`` using an LLM when API key is present.
    Falls back to concatenating topic cues when offline (tests / no key).
    """
    from foresight_x.shadow.thread_context import format_recent_conversation_section

    prev = str(thread.get("working_summary") or "").strip()
    recent_block = format_recent_conversation_section(recent_messages)
    key = getattr(settings, "openai_api_key", "") or ""
    if not str(key).strip():
        # Minimal deterministic fallback so navigation still keeps some thread memory.
        snippet = recent_block[-900:] if len(recent_block) > 900 else recent_block
        merged = (prev + "\n\n" + snippet).strip() if prev else snippet
        thread["working_summary"] = merged[-2300:]
        return thread["working_summary"]

    llm = build_openai_llm(settings, temperature=0.25)
    prompt = _SUMMARY_PROMPT.format(prev=prev or "(none)", recent=recent_block)
    out = structured_predict(llm, ThreadWorkingSummaryLLM, prompt)
    summary = (out.working_summary or "").strip()
    if not summary:
        thread["working_summary"] = prev
        return prev
    thread["working_summary"] = summary[:2400]
    return thread["working_summary"]


def maybe_update_thread_summary(
    thread: dict[str, Any],
    *,
    settings: Any,
    step_messages: int = 14,
) -> None:
    """Update summary periodically as the thread grows (mutates thread)."""
    msgs = thread.get("messages") or []
    if not isinstance(msgs, list):
        return
    n = len(msgs)
    if n < 12:
        return
    last_n = int(thread.get("_shadow_summary_at_msg_len") or 0)
    has_summary = bool((thread.get("working_summary") or "").strip())
    if has_summary and (n - last_n) < step_messages:
        return
    recent = msgs[-40:] if len(msgs) > 40 else msgs
    slim = [{"role": m.get("role"), "content": m.get("content")} for m in recent if isinstance(m, dict)]
    update_thread_working_summary(thread, slim, settings=settings)
    thread["_shadow_summary_at_msg_len"] = n

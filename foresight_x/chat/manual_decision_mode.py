"""Manual Decision Mode: enhance user text and ask for confirmation before report generation."""

from __future__ import annotations

import re


def decision_topic_snippet(enhanced_question: str, *, max_len: int = 72) -> str:
    """Short label for 'you seem to be deciding about …' copy."""
    text = " ".join((enhanced_question or "").strip().split())
    if not text:
        return "this choice"
    text = text.rstrip("?.!。！？")
    for prefix in (
        r"^should i\s+",
        r"^do i\s+",
        r"^would it be better to\s+",
        r"^is it better to\s+",
        r"^help me decide (whether|if)\s+to\s+",
        r"^help me decide\s+",
        r"^i(?:'m| am) trying to decide (whether|if)\s+to\s+",
        r"^i(?:'m| am) deciding (whether|if)\s+to\s+",
    ):
        text = re.sub(prefix, "", text, flags=re.I)
    text = text.strip() or enhanced_question.strip()
    if len(text) <= max_len:
        return text
    cut = text[:max_len].rsplit(" ", 1)[0]
    return (cut or text[:max_len]).strip() + "…"


def build_manual_decision_confirmation(*, original: str, enhanced: str) -> str:
    """Assistant reply after the user sends while manual Decision Mode is on."""
    prompt = (enhanced or original).strip()
    topic = decision_topic_snippet(prompt)
    return (
        f"You manually turned on **Decision Mode**. It sounds like you're deciding about **{topic}**.\n\n"
        f"Here's the decision question I'll use for the report:\n\n> {prompt}\n\n"
        "Tap **Yes** below when you're ready and I'll generate the structured decision report."
    )

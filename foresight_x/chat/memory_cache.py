from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class MemoryCacheEntry:
    memory_block: str
    created_at: datetime
    topic_hash: str
    source_version: str
    mode: str


_CACHE: dict[tuple[str, str], MemoryCacheEntry] = {}
_TTL = timedelta(minutes=8)


def _topic_hash(text: str) -> str:
    x = " ".join((text or "").strip().lower().split())[:240]
    return hashlib.sha1(x.encode("utf-8")).hexdigest()[:16]


def _topic_tokens(text: str) -> set[str]:
    raw = {w.lower() for w in re.findall(r"[a-zA-Z][a-zA-Z'-]{2,}", text or "")}
    stop = {"the", "and", "for", "with", "that", "this", "from", "have", "been", "were", "your", "about"}
    return {w for w in raw if w not in stop}


def _topic_overlap_ratio(message: str, recent_messages: list[dict] | None) -> float:
    cur = _topic_tokens(message)
    if not cur:
        return 1.0
    if len(cur) <= 1:
        # Short follow-ups like "why"/"continue" should not be penalized by lexical overlap.
        return 1.0
    ctx_bits: list[str] = []
    for row in (recent_messages or [])[-6:]:
        if not isinstance(row, dict):
            continue
        if str(row.get("role") or "") != "user":
            continue
        txt = str(row.get("content") or "").strip()
        if txt:
            ctx_bits.append(txt)
    if not ctx_bits:
        return 1.0
    prev = _topic_tokens(" ".join(ctx_bits))
    if not prev:
        return 1.0
    inter = len(cur & prev)
    return inter / max(1, len(cur))


def is_followup_message(message: str, recent_messages: list[dict] | None = None) -> bool:
    t = (message or "").strip().lower()
    if not t:
        return False
    short_followups = {"continue", "why", "expand", "what about that", "继续", "那怎么办", "展开讲", "那如果选a呢"}
    if t in short_followups:
        return True
    if len(t) <= 20 and any(k in t for k in ["why", "continue", "then", "what if", "继续", "然后"]):
        return True
    return False


def should_use_memory_cache(
    message: str,
    recent_messages: list[dict] | None,
    entry: MemoryCacheEntry | None,
    *,
    source_version: str,
    min_topic_overlap: float = 0.25,
) -> bool:
    if entry is None:
        return False
    if _now() - entry.created_at > _TTL:
        return False
    if entry.source_version != source_version:
        return False
    if not is_followup_message(message, recent_messages):
        return False
    # Hard topic match: exact normalized message hash (very cheap).
    if entry.topic_hash == _topic_hash(message):
        return True
    # Soft topic match: require overlap against recent user context.
    overlap = _topic_overlap_ratio(message, recent_messages)
    if overlap < max(0.0, min(1.0, float(min_topic_overlap))):
        return False
    return True


def get_memory_cache(user_id: str, thread_id: str) -> MemoryCacheEntry | None:
    return _CACHE.get((user_id, thread_id))


def set_memory_cache(
    user_id: str,
    thread_id: str,
    *,
    memory_block: str,
    message: str,
    source_version: str,
    mode: str,
) -> None:
    _CACHE[(user_id, thread_id)] = MemoryCacheEntry(
        memory_block=memory_block,
        created_at=_now(),
        topic_hash=_topic_hash(message),
        source_version=source_version,
        mode=mode,
    )


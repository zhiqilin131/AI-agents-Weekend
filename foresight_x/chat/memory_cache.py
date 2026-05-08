from __future__ import annotations

import hashlib
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
) -> bool:
    if entry is None:
        return False
    if _now() - entry.created_at > _TTL:
        return False
    if entry.source_version != source_version:
        return False
    if not is_followup_message(message, recent_messages):
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


from __future__ import annotations

from datetime import datetime, timedelta, timezone

from foresight_x.chat.memory_cache import MemoryCacheEntry, set_memory_cache, should_use_memory_cache


def test_should_use_memory_cache_accepts_short_followup_without_topic_overlap() -> None:
    user_id = "u_cache"
    thread_id = "t1"
    set_memory_cache(
        user_id,
        thread_id,
        memory_block="Fast memory recall: ...",
        message="Should I prioritize internship or World Cup?",
        source_version="v1",
        mode="chat_fast",
    )
    entry = MemoryCacheEntry(
        memory_block="Fast memory recall: ...",
        created_at=datetime.now(timezone.utc),
        topic_hash="not_used_here",
        source_version="v1",
        mode="chat_fast",
    )
    assert should_use_memory_cache(
        "why",
        [{"role": "user", "content": "Should I prioritize internship or World Cup?"}],
        entry,
        source_version="v1",
        min_topic_overlap=0.4,
    )


def test_should_use_memory_cache_rejects_topic_drift_for_followup_like_message() -> None:
    entry = MemoryCacheEntry(
        memory_block="Fast memory recall: ...",
        created_at=datetime.now(timezone.utc),
        topic_hash="deadbeefdeadbeef",
        source_version="v1",
        mode="chat_fast",
    )
    assert not should_use_memory_cache(
        "what if we switch to salmon recipes",
        [{"role": "user", "content": "Should I prioritize internship or World Cup?"}],
        entry,
        source_version="v1",
        min_topic_overlap=0.35,
    )


def test_should_use_memory_cache_rejects_stale_entries() -> None:
    old_entry = MemoryCacheEntry(
        memory_block="old",
        created_at=datetime.now(timezone.utc) - timedelta(minutes=20),
        topic_hash="abc",
        source_version="v1",
        mode="chat_fast",
    )
    assert not should_use_memory_cache(
        "continue",
        [{"role": "user", "content": "Should I prioritize internship or World Cup?"}],
        old_entry,
        source_version="v1",
    )

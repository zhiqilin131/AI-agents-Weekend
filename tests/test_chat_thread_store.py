from typing import Any

import pytest
from pydantic import BaseModel

from foresight_x.chat.thread_store import (
    ThreadNotFoundError,
    append_message,
    create_thread,
    delete_thread,
    load_thread,
    regenerate_thread_title,
    set_manual_thread_title,
)


class _Resp:
    def __init__(self, data: list[dict[str, Any]]):
        self.data = data


class _FakeSupabaseQuery:
    def __init__(self, client: "_FakeSupabaseClient", table_name: str):
        self.client = client
        self.table_name = table_name
        self.op = ""
        self.filters: list[tuple[str, Any]] = []

    def delete(self) -> "_FakeSupabaseQuery":
        self.op = "delete"
        self.client.calls.append((self.table_name, "delete", None))
        return self

    def eq(self, key: str, value: Any) -> "_FakeSupabaseQuery":
        self.filters.append((key, value))
        self.client.calls.append((self.table_name, "eq", (key, value)))
        return self

    def execute(self) -> _Resp:
        self.client.calls.append((self.table_name, "execute", tuple(self.filters)))
        if self.table_name == "threads" and self.op == "delete":
            return _Resp([{"id": "thread-1"}])
        return _Resp([])


class _FakeSupabaseClient:
    def __init__(self):
        self.calls: list[tuple[str, str, Any]] = []

    def table(self, name: str) -> _FakeSupabaseQuery:
        self.calls.append((name, "table", None))
        return _FakeSupabaseQuery(self, name)


def test_append_message_merges_metadata_extra() -> None:
    t = create_thread(user_id="demo_user")
    append_message(
        t,
        role="assistant",
        content="",
        mode="decision_report",
        decision_id="dec-1",
        memory_used=True,
        metadata_extra={
            "type": "decision_report_artifact",
            "title": "Decision Report",
            "summary": "Test summary",
            "status": "complete",
        },
    )
    loaded = load_thread(t["thread_id"], user_id="demo_user")
    meta = loaded["messages"][-1]["metadata"]
    assert meta["type"] == "decision_report_artifact"
    assert meta["summary"] == "Test summary"
    assert meta["decision_id"] == "dec-1"
    assert "dec-1" in loaded.get("linked_decision_ids", [])


def test_thread_persists_messages_across_mode_changes() -> None:
    t = create_thread(user_id="demo_user")
    append_message(t, role="user", content="hi", mode="normal")
    t["mode"] = "roleplay"
    append_message(t, role="assistant", content="hello", mode="roleplay")

    loaded = load_thread(t["thread_id"], user_id="demo_user")
    assert loaded["mode"] == "roleplay"
    assert len(loaded["messages"]) == 2
    assert loaded["messages"][0]["content"] == "hi"
    assert loaded["messages"][1]["content"] == "hello"


def test_autotitle_skips_light_greeting_and_uses_meaningful_user_message() -> None:
    t = create_thread(user_id="demo_user")
    append_message(t, role="user", content="Hi", mode="normal")
    append_message(t, role="assistant", content="Hey there.", mode="normal")
    loaded1 = load_thread(t["thread_id"], user_id="demo_user")
    assert loaded1["title"] == "New chat"

    append_message(
        t,
        role="user",
        content="Help me decide between startup role and MBA next year",
        mode="normal",
    )
    append_message(
        t,
        role="assistant",
        content="Let's break down startup role and MBA paths.",
        mode="normal",
    )
    loaded2 = load_thread(t["thread_id"], user_id="demo_user")
    assert loaded2["title"] != "New chat"
    assert loaded2["title"] != "Conversation"
    assert len(loaded2["title"].split()) <= 8


def test_autotitle_replaces_legacy_placeholder_conversation() -> None:
    t = create_thread(user_id="demo_user", title="Conversation")
    append_message(
        t,
        role="user",
        content="I need a weekly study plan for machine learning interviews",
        mode="normal",
    )
    append_message(
        t,
        role="assistant",
        content="Here is a 4-week prep structure.",
        mode="normal",
    )
    loaded = load_thread(t["thread_id"], user_id="demo_user")
    assert loaded["title"] != "Conversation"
    assert loaded["title"] != "New chat"


def test_autotitle_does_not_override_custom_title() -> None:
    t = create_thread(user_id="demo_user", title="Custom Named Thread")
    append_message(
        t,
        role="user",
        content="Help me prioritize three project options for Q3",
        mode="normal",
    )
    loaded = load_thread(t["thread_id"], user_id="demo_user")
    assert loaded["title"] == "Custom Named Thread"


def test_autotitle_between_or_pattern_is_compact_comparison() -> None:
    t = create_thread(user_id="demo_user")
    append_message(
        t,
        role="user",
        content=(
            "I'm torn between staying in my current job or leaving this year to pursue "
            "a master's degree."
        ),
        mode="normal",
    )
    append_message(
        t,
        role="assistant",
        content="Let's compare your job and master's options side by side.",
        mode="normal",
    )
    loaded = load_thread(t["thread_id"], user_id="demo_user")
    ttl = loaded["title"].lower()
    assert "vs" in ttl
    assert "job" in ttl
    assert ("master" in ttl) or ("degree" in ttl)
    assert ttl != "new chat"
    assert ttl != "conversation"


def test_autotitle_prefers_llm_intent_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeTitleOut(BaseModel):
        title: str = "Startup role vs MBA timing"

    monkeypatch.setenv("PYTEST_CURRENT_TEST", "")
    monkeypatch.setattr("foresight_x.chat.thread_store.build_openai_llm", lambda **_: object())
    monkeypatch.setattr("foresight_x.chat.thread_store.structured_predict", lambda *_args, **_kwargs: _FakeTitleOut())
    monkeypatch.setattr("foresight_x.chat.thread_store._AUTOTITLE_LLM_ATTEMPTED_THREAD_IDS", set())

    t = create_thread(user_id="demo_user")
    append_message(
        t,
        role="user",
        content="I'm deciding whether to keep my startup offer or apply for MBA this year.",
        mode="normal",
    )
    append_message(
        t,
        role="assistant",
        content="I can help you compare both with timeline and risk.",
        mode="normal",
    )
    loaded = load_thread(t["thread_id"], user_id="demo_user")
    assert loaded["title"] == "Startup role vs MBA timing"


def test_autotitle_triggers_after_assistant_not_user_only() -> None:
    t = create_thread(user_id="demo_user")
    append_message(
        t,
        role="user",
        content="Help me decide between taking a PM offer and staying in engineering",
        mode="normal",
    )
    loaded_before = load_thread(t["thread_id"], user_id="demo_user")
    assert loaded_before["title"] == "New chat"

    append_message(
        t,
        role="assistant",
        content="Let's compare PM and engineering tracks with your goals.",
        mode="normal",
    )
    loaded_after = load_thread(t["thread_id"], user_id="demo_user")
    assert loaded_after["title"] != "New chat"
    assert loaded_after.get("title_source") == "auto"


def test_thread_title_source_manual_and_auto_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeTitleOut(BaseModel):
        title: str = "MBA vs startup decision"

    monkeypatch.setenv("PYTEST_CURRENT_TEST", "")
    monkeypatch.setattr("foresight_x.chat.thread_store.build_openai_llm", lambda **_: object())
    monkeypatch.setattr("foresight_x.chat.thread_store.structured_predict", lambda *_args, **_kwargs: _FakeTitleOut())
    monkeypatch.setattr("foresight_x.chat.thread_store._AUTOTITLE_LLM_ATTEMPTED_THREAD_IDS", set())

    t = create_thread(user_id="demo_user", title="My custom title")
    assert t.get("title_source") == "manual"

    set_manual_thread_title(t, "Another custom title")
    assert t["title"] == "Another custom title"
    assert t.get("title_source") == "manual"

    append_message(t, role="user", content="Should I do MBA or join startup now?", mode="normal")
    append_message(t, role="assistant", content="Let's compare both paths quickly.", mode="normal")
    regenerate_thread_title(t)
    assert t["title"] == "MBA vs startup decision"
    assert t.get("title_source") == "auto"


def test_load_thread_strict_missing_raises() -> None:
    with pytest.raises(ThreadNotFoundError):
        load_thread("00000000-0000-4000-8000-000000000000", user_id="demo_user", allow_create=False)


def test_load_thread_strict_none_raises() -> None:
    with pytest.raises(ThreadNotFoundError):
        load_thread(None, user_id="demo_user", allow_create=False)


def test_supabase_delete_thread_wrong_user_does_not_delete_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeSupabaseClient()
    monkeypatch.setattr("foresight_x.chat.thread_store._supabase_enabled", lambda: True)
    monkeypatch.setattr("foresight_x.chat.thread_store.get_client", lambda: fake)
    monkeypatch.setattr("foresight_x.chat.thread_store._fetch_thread_row_supabase", lambda **_: None)

    ok = delete_thread(user_id="user-b", thread_id="thread-owned-by-user-a")

    assert ok is False
    assert fake.calls == []


def test_supabase_delete_thread_owner_deletes_messages_then_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeSupabaseClient()
    monkeypatch.setattr("foresight_x.chat.thread_store._supabase_enabled", lambda: True)
    monkeypatch.setattr("foresight_x.chat.thread_store.get_client", lambda: fake)
    monkeypatch.setattr(
        "foresight_x.chat.thread_store._fetch_thread_row_supabase",
        lambda **_: {"id": "thread-1", "user_id": "user-a"},
    )

    ok = delete_thread(user_id="user-a", thread_id="thread-1")

    assert ok is True
    assert ("messages", "delete", None) in fake.calls
    assert ("messages", "eq", ("thread_id", "thread-1")) in fake.calls
    assert ("threads", "delete", None) in fake.calls
    assert ("threads", "eq", ("id", "thread-1")) in fake.calls
    assert ("threads", "eq", ("user_id", "user-a")) in fake.calls

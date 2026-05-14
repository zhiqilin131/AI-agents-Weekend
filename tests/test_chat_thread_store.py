from typing import Any

import pytest

from foresight_x.chat.thread_store import (
    ThreadNotFoundError,
    append_message,
    create_thread,
    delete_thread,
    load_thread,
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

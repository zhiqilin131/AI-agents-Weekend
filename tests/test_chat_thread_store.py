from foresight_x.chat.thread_store import append_message, create_thread, load_thread


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


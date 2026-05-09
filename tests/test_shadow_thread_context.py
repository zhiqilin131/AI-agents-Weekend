"""Shadow Chat thread window, local-context routing, and memory durability gates."""

from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact, UserProfile
from foresight_x.shadow.memory_durability import (
    classify_memory_durability,
    identity_merge_conflict,
    should_confirm_identity_overwrite,
)
from foresight_x.shadow.thread_context import (
    format_recent_conversation_section,
    get_recent_thread_context,
    is_local_context_question,
)
from foresight_x.shadow.thread_summary import update_thread_working_summary


def test_get_recent_thread_context_skips_artifacts_and_preserves_order() -> None:
    msgs = [
        {"role": "user", "content": "hello"},
        {
            "role": "assistant",
            "content": "",
            "metadata": {"type": "decision_report_artifact"},
        },
        {"role": "assistant", "content": "hi back"},
        {"role": "user", "content": "what joke did I make?"},
    ]
    recent = get_recent_thread_context(msgs, max_messages=16)
    roles = [m["role"] for m in recent]
    assert roles == ["user", "assistant", "user"]
    assert "decision_report" not in format_recent_conversation_section(recent)


def test_is_local_context_question_en_zh() -> None:
    assert is_local_context_question("What did I just say?")
    assert is_local_context_question("what joke did I make earlier in this chat")
    assert is_local_context_question("我刚才说了什么")
    assert is_local_context_question("我刚刚开的玩笑是什么？")
    assert is_local_context_question("我们刚刚聊到哪")
    assert not is_local_context_question("What is the capital of France?")


def test_joke_name_classified_thread_only_not_profile() -> None:
    r = classify_memory_durability(
        "haha my name is Super Potato King",
        [{"role": "user", "content": "haha my name is Super Potato King"}],
        "User's name is Super Potato King",
        category_hint=MemoryFactCategory.IDENTITY,
        predicate_hint="preferred_name",
    )
    assert r.durability == "thread_only"
    assert r.is_joke


def test_explicit_remember_is_long_term() -> None:
    r = classify_memory_durability(
        "Remember that I prefer concise answers.",
        [],
        "Prefers concise answers",
        category_hint=MemoryFactCategory.VIEWS,
    )
    assert r.durability == "long_term_profile"


def test_real_name_correction_long_term() -> None:
    r = classify_memory_durability(
        "My real name is Bob Yang.",
        [],
        "Legal name is Bob Yang",
        category_hint=MemoryFactCategory.IDENTITY,
    )
    assert r.durability == "long_term_profile"


def test_roleplay_thread_only() -> None:
    r = classify_memory_durability(
        "Pretend I am a WWII soldier.",
        [],
        "User roleplays as a WWII soldier",
        category_hint=MemoryFactCategory.IDENTITY,
    )
    assert r.durability == "thread_only"
    assert r.is_roleplay


def test_identity_conflict_detected_for_confirmation() -> None:
    prof = UserProfile(
        memory_facts=[
            ProfileMemoryFact(
                id="1",
                category=MemoryFactCategory.IDENTITY,
                text="user preferred_name River",
                predicate="preferred_name",
                object_value="River",
            )
        ]
    )
    candidate = ProfileMemoryFact(
        id="",
        category=MemoryFactCategory.IDENTITY,
        text="user preferred_name Casey",
        predicate="preferred_name",
        object_value="Casey",
    )
    assert identity_merge_conflict(prof, candidate)
    assert should_confirm_identity_overwrite(prof, candidate, "Casey sounds nicer haha")


def test_explicit_correction_skips_confirmation() -> None:
    prof = UserProfile(
        memory_facts=[
            ProfileMemoryFact(
                id="1",
                category=MemoryFactCategory.IDENTITY,
                text="user preferred_name Bob Yang",
                predicate="preferred_name",
                object_value="Bob Yang",
            )
        ]
    )
    candidate = ProfileMemoryFact(
        id="",
        category=MemoryFactCategory.IDENTITY,
        text="user preferred_name River",
        predicate="preferred_name",
        object_value="River",
    )
    assert identity_merge_conflict(prof, candidate)
    assert not should_confirm_identity_overwrite(prof, candidate, "Actually, call me River from now on.")


def test_thread_summary_fallback_without_api_key(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    class _S:
        foresight_data_dir = tmp_path
        openai_api_key = ""

    thread = {"messages": [{"role": "user", "content": "joke name Banana"}]}
    recent = [{"role": "user", "content": "joke name Banana"}]
    out = update_thread_working_summary(thread, recent, settings=_S())
    assert "Banana" in out or "joke" in out.lower()

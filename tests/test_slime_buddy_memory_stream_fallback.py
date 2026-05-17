"""Slime Buddy must persist memory when voice streaming skips structured memory_facts."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from foresight_x.config import Settings
from foresight_x.profile.proactive_memory import ProactiveMemoryDraft
from foresight_x.shadow.chat import ShadowMemoryFactDraft, _buddy_memory_drafts_fallback, run_shadow_turn


def test_buddy_memory_drafts_fallback_maps_proactive_rows() -> None:
    with patch(
        "foresight_x.profile.proactive_memory.extract_memory_drafts_from_turn",
        return_value=[
            ProactiveMemoryDraft(
                category="views",
                text="User prefers concise answers.",
                subject_ref="user",
                predicate="prefers",
                object_value="concise answers",
            )
        ],
    ) as mock_extract:
        drafts = _buddy_memory_drafts_fallback(
            settings=Settings(foresight_user_id="u", openai_api_key="sk-test"),
            last_user_text="I prefer concise answers in chat.",
            reply="Got it.",
            slime_type="generalized",
            llm_model=None,
        )
    mock_extract.assert_called_once()
    assert len(drafts) == 1
    assert drafts[0].text == "User prefers concise answers."
    assert drafts[0].predicate == "prefers"


def test_run_shadow_turn_streaming_invokes_buddy_memory_fallback(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_stream_mem"
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / f"{uid}.json").write_text(
        json.dumps({"user_id": uid, "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )
    msgs = [{"role": "user", "content": "Please remember I am applying for master's programs."}]
    fallback_draft = ShadowMemoryFactDraft(
        category="goals",
        text="User is applying for master's programs.",
        subject_ref="user",
        predicate="applying_for",
        object_value="master's programs",
        evidence="applying for master's programs",
    )

    with patch("foresight_x.shadow.chat._stream_reply_text", return_value="I'll keep that in mind."):
        with patch(
            "foresight_x.shadow.chat._buddy_memory_drafts_fallback",
            return_value=[fallback_draft],
        ) as mock_fallback:
            with patch("foresight_x.shadow.chat.classify_memory_durability") as mock_cls:
                mock_cls.return_value = MagicMock(
                    durability="long_term_profile",
                    confidence=0.8,
                    is_roleplay=False,
                    is_joke=False,
                )
                with patch("foresight_x.shadow.chat.append_profile_memory_records_with_events") as mock_append:
                    mock_append.return_value = (
                        MagicMock(),
                        [MagicMock(model_dump=lambda: {"text": fallback_draft.text, "action": "new"})],
                    )
                    with patch("foresight_x.shadow.chat.save_user_profile"):
                        with patch("foresight_x.shadow.chat.load_shadow_self") as mock_self:
                            st = MagicMock(turn_count=0)
                            st.model_copy.return_value = MagicMock(turn_count=1)
                            mock_self.return_value = st
                            with patch("foresight_x.shadow.chat.save_shadow_self"):
                                out = run_shadow_turn(
                                    msgs,
                                    settings=settings,
                                    synthesis_frame="slime_buddy",
                                    slime_type="generalized",
                                    reply_delta_callback=lambda _d: None,
                                )
    mock_fallback.assert_called_once()
    assert out.reply == "I'll keep that in mind."

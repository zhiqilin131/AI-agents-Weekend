"""Voice spoken_sequence splits sentences for multi-part TTS."""

from foresight_x.chat.conversation_service import _split_spoken_sequence


def test_split_spoken_sequence_multiple_sentences() -> None:
    parts = _split_spoken_sequence(
        "It sounds like you are still anxious. That can be really tough when feelings are intense."
    )
    assert len(parts) == 2
    assert parts[0].endswith(".")
    assert "tough" in parts[1]


def test_split_spoken_sequence_single_block_unchanged() -> None:
    text = "One sentence only, with a comma but no period end"
    assert _split_spoken_sequence(text) == [text]

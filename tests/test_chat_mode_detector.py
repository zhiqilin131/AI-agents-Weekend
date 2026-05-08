from foresight_x.chat.mode_detector import detect_chat_mode_intent


def test_detect_roleplay_candidate() -> None:
    out = detect_chat_mode_intent("Please pretend to be a pirate and roleplay with me.")
    assert out.intent == "roleplay_candidate"
    assert out.suggested_action == "show_role_mode_prompt"


def test_detect_decision_candidate() -> None:
    out = detect_chat_mode_intent("Should I pick Option A or Option B? Help me decide with tradeoff and risk.")
    assert out.intent == "decision_candidate"
    assert out.suggested_action == "show_decision_report_prompt"


def test_normal_message_stays_normal() -> None:
    out = detect_chat_mode_intent("How do I boil eggs?")
    assert out.intent == "normal"
    assert out.suggested_action == "continue"


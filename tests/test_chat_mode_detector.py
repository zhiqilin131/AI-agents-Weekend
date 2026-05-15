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


def test_roulette_choice_triggers_decision_candidate() -> None:
    out = detect_chat_mode_intent("red or black I need a winning number for roulette")
    assert out.intent == "decision_candidate"
    assert out.suggested_action == "show_decision_report_prompt"


def test_explicit_start_decision_mode_triggers_decision_candidate() -> None:
    out = detect_chat_mode_intent("进入决策模式")
    assert out.intent == "decision_candidate"
    assert out.confidence >= 0.95


def test_activate_decision_mode_english() -> None:
    from foresight_x.chat.decision_trigger import is_explicit_decision_mode_command

    assert is_explicit_decision_mode_command("Activate decision mode")
    out = detect_chat_mode_intent(
        "Activate decision mode. Shall I move to the new apartment or stay where I am?"
    )
    assert out.intent == "decision_candidate"

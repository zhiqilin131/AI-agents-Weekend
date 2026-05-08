from foresight_x.chat.intent_detector import detect_chat_intent


def test_decision_intent_english() -> None:
    out = detect_chat_intent(
        "I have two internship offers and a deadline tomorrow. Should I pick option A or option B?",
        [],
        llm_enabled=False,
    )
    assert out.intent == "decision_candidate"
    assert out.suggested_action == "show_decision_report_prompt"


def test_decision_intent_chinese() -> None:
    out = detect_chat_intent("我该不该去A公司还是B公司，帮我决定一下利弊和风险。", [], llm_enabled=False)
    assert out.intent == "decision_candidate"


def test_casual_message_not_triggered() -> None:
    out = detect_chat_intent("How to cook pasta quickly?", [], llm_enabled=False)
    assert out.intent == "normal"


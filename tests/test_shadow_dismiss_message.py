"""Shadow thread dismiss_suggestion accepts empty message body."""

from __future__ import annotations

from foresight_x.ui.api_server import ShadowThreadMessageRequest


def test_dismiss_suggestion_allows_empty_message() -> None:
    body = ShadowThreadMessageRequest(user_action="dismiss_suggestion", message="")
    assert body.user_action == "dismiss_suggestion"
    assert body.message == ""


def test_send_message_requires_non_empty_message() -> None:
    try:
        ShadowThreadMessageRequest(user_action="send_message", message="   ")
        raised = False
    except ValueError:
        raised = True
    assert raised

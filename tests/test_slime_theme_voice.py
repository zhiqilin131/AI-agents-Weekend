"""Theme/color routing for Slime voice and chat NL patches."""

from __future__ import annotations

from foresight_x.chat.slime_intent import classify_slime_intent
from foresight_x.config import Settings
from foresight_x.voice.slime_voice_router import SlimeVoiceContext, route_slime_voice_command


def test_classify_appearance_change_color_phrase() -> None:
    r = classify_slime_intent("change color to mint")
    assert r.intent == "profile_update"


def test_classify_appearance_switch_color() -> None:
    r = classify_slime_intent("switch color to violet")
    assert r.intent == "profile_update"


def test_classify_appearance_chinese() -> None:
    r = classify_slime_intent("换个颜色，我要薄荷色")
    assert r.intent == "profile_update"


def test_route_quick_theme_single_word_no_openai() -> None:
    settings = Settings(foresight_user_id="u", openai_api_key="")
    ctx = SlimeVoiceContext(user_id="u")
    r = route_slime_voice_command("mint", ctx, settings=settings)
    # Color theme personalization disabled — no quick color patch.
    assert r.tool_name != "update_slime_profile" or "color_theme" not in (r.arguments.get("patch") or {})


def test_route_quick_theme_switch_to_no_openai() -> None:
    settings = Settings(foresight_user_id="u", openai_api_key="")
    ctx = SlimeVoiceContext(user_id="u")
    r = route_slime_voice_command("switch to aurora", ctx, settings=settings)
    assert "color_theme" not in (r.arguments.get("patch") or {})


def test_route_quick_theme_chinese_no_openai() -> None:
    settings = Settings(foresight_user_id="u", openai_api_key="")
    ctx = SlimeVoiceContext(user_id="u")
    r = route_slime_voice_command("把颜色换成薄荷色", ctx, settings=settings)
    assert "color_theme" not in (r.arguments.get("patch") or {})


def test_route_quick_theme_call_me_mint_is_nickname_not_color() -> None:
    settings = Settings(foresight_user_id="u", openai_api_key="")
    ctx = SlimeVoiceContext(user_id="u")
    r = route_slime_voice_command("call me mint", ctx, settings=settings)
    assert r.tool_name == "update_slime_profile"
    assert r.arguments.get("patch", {}).get("persona", {}).get("user_nickname") == "mint"
    assert "color_theme" not in r.arguments.get("patch", {})

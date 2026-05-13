from foresight_x.config import Settings
from foresight_x.llm.model_resolve import get_model_option_for_request
from foresight_x.schemas import UserProfile


def _settings_with_catalog() -> Settings:
    return Settings(
        foresight_user_id="u_model_resolve",
        openai_model_little="gpt-4o-mini",
        openai_model_swift="gpt-4o-mini",
        openai_model_balanced="gpt-4.1",
        openai_model_deep="o3",
        default_model_option="swift",
    )


def test_slime_voice_prefers_feature_default_over_profile_default() -> None:
    settings = _settings_with_catalog()
    profile = UserProfile(user_id="u_model_resolve", default_model_option_id="deep")
    picked = get_model_option_for_request(settings, "slime_voice", None, profile=profile)
    assert picked.id == "little"


def test_non_voice_still_honors_profile_default_when_available() -> None:
    settings = _settings_with_catalog()
    profile = UserProfile(user_id="u_model_resolve", default_model_option_id="deep")
    picked = get_model_option_for_request(settings, "shadow_chat", None, profile=profile)
    assert picked.id == "deep"

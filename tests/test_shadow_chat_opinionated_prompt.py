from foresight_x.shadow.chat import SHADOW_INSTRUCTIONS, SLIME_BUDDY_INSTRUCTIONS


def test_shadow_prompts_require_direct_opinionated_answers() -> None:
    for prompt in (SHADOW_INSTRUCTIONS, SLIME_BUDDY_INSTRUCTIONS):
        assert "answer directly first" in prompt
        assert "provisional pick" in prompt
        assert "both are valid" in prompt
        assert "No picking their decision for them" not in prompt

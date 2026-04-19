"""One turn of shadow chat: therapist-leaning tone, no decisions; updates shadow notes."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from foresight_x.config import Settings, load_settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.profile.merge import append_inferred_priority_line
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.shadow.store import ShadowSelfState, load_shadow_self, merge_observation, save_shadow_self
from foresight_x.structured_predict import structured_predict


class ShadowChatTurn(BaseModel):
    reply_to_user: str = Field(
        description=(
            "Direct reply to the user (second person: you). Engage with what they actually said—same topic, "
            "same stakes—without replacing their words with generic therapy language. "
            "FORBIDDEN: third-person summaries ('User is expressing…'), vague 'deeper emotional/psychological themes', "
            "or sanitizing stigmatizing or sensitive content into abstract 'feelings'. "
            "Warm, curious, friend-like; no decision recommendations or numbered action plans."
        )
    )
    suggest_decision_navigation: bool = Field(
        description=(
            "True only if the user is clearly asking for a concrete decision, which option to pick, "
            "or to run the Foresight / decision analysis mode."
        )
    )
    shadow_observation: str = Field(
        default="",
        description=(
            "Optional ONE concrete note (max 220 chars) tied to this turn's actual content—specific words or pattern. "
            "FORBIDDEN: generic paraphrases like 'deeper themes' or clinical fluff. "
            "Use empty string if nothing specific to record."
        ),
    )


def _format_transcript(messages: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for m in messages:
        role = str(m.get("role", "")).strip()
        content = str(m.get("content", "")).strip()
        if role == "system" or not content:
            continue
        label = "User" if role == "user" else "Assistant"
        lines.append(f"{label}: {content}")
    return "\n".join(lines)


SHADOW_INSTRUCTIONS = """You are in "Shadow space" — a private, off-the-record reflective chat (not a public assistant).

FAITHFUL LANGUAGE (strict):
- Respond in direct address (you / I), as a friend and careful listener. Stay on the user's actual topic and wording.
- Do NOT paraphrase their message into vague psychology or "wellness" speak. Do NOT substitute abstract
  "emotional themes", "psychological patterns", or "deeper feelings" for what they concretely said.
- Do NOT write third-person case notes (e.g. "User is expressing…", "The user seems to be navigating…").
- Do NOT sanitize, soften, or euphemize sensitive, stigmatized, or legally fraught topics if the user named them
  plainly—you still do not endorse harm; you engage with the real thread they opened without moral laundering
  through generic reflective filler.
- Short paragraphs. No clinical jargon unless the user used it first.

WHAT YOU STILL DO NOT DO HERE:
- No concrete decisions, rankings, "you should", or step-by-step life plans (that is Decision mode elsewhere).
- If they clearly want option-picking or Foresight-X analysis, reply warmly and set suggest_decision_navigation true;
  you still do not pick for them in this chat.

OBSERVATION FIELD:
- shadow_observation: at most one plain, specific line about what you noticed THIS turn (or empty). Never a generic
  summary like "ties to deeper emotional themes".

Current accumulated notes about this user (may be empty):
{shadow_block}

Full conversation so far:
{transcript}

Return JSON matching the schema: reply_to_user (faithful, direct), suggest_decision_navigation, shadow_observation."""


def run_shadow_turn(
    messages: list[dict[str, Any]],
    *,
    settings: Settings | None = None,
) -> tuple[str, bool, ShadowSelfState, str | None]:
    """Return (assistant_reply, suggest_decision_navigation, updated_state, recorded_observation_or_none)."""
    s = settings or load_settings()
    if not messages:
        raise ValueError("messages must be non-empty")
    last = messages[-1]
    if str(last.get("role")) != "user":
        raise ValueError("last message must be from user")

    if not (s.openai_api_key or "").strip():
        raise RuntimeError("OPENAI_API_KEY is required for shadow chat")

    llm = build_openai_llm(s, temperature=0.68)

    state = load_shadow_self(settings=s)
    shadow_block = state.narrative.strip() or "(none yet — first turns.)"
    transcript = _format_transcript(messages)

    prompt = SHADOW_INSTRUCTIONS.format(shadow_block=shadow_block, transcript=transcript)
    turn = structured_predict(llm, ShadowChatTurn, prompt)

    reply = turn.reply_to_user.strip()
    flag = bool(turn.suggest_decision_navigation)
    obs = (turn.shadow_observation or "").strip()
    if len(obs) > 220:
        obs = obs[:217] + "…"

    recorded: str | None = None
    if obs:
        state = merge_observation(state, obs)
        recorded = obs
    else:
        state = state.model_copy(update={"turn_count": state.turn_count + 1})
    save_shadow_self(state, settings=s)

    if recorded:
        prof = load_user_profile(settings=s)
        prof = append_inferred_priority_line(prof, recorded)
        save_user_profile(prof, settings=s)

    return reply, flag, state, recorded

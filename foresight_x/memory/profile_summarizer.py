"""
Periodic reflection pass: reads Tier 2 past decisions + prior profile, produces an
updated Tier 3 UserProfile via LLM structured_predict.
"""

from __future__ import annotations

import json

from foresight_x.config import load_settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.schemas import PastDecision, UserProfile
from foresight_x.structured_predict import structured_predict
from foresight_x.prompts.profile_summarizer import PROFILE_SUMMARIZER_PROMPT
from foresight_x.memory.profile_store import empty_profile, load_profile, save_profile


def summarize_profile(
    user_id: str,
    past_decisions: list[PastDecision],
    llm=None,
) -> UserProfile:
    """
    Produce an updated UserProfile for this user based on their past decisions.
    Uses prior profile (if any) as an anchor so profiles drift slowly.
    Persists result to disk.
    """
    if llm is None:
        llm = build_openai_llm(load_settings())

    prior = load_profile(user_id) or empty_profile(user_id)
    prompt = PROFILE_SUMMARIZER_PROMPT.format(
        prior_profile_json=json.dumps(prior.model_dump(), indent=2),
        past_decisions_json=json.dumps(
            [d.model_dump() for d in past_decisions],
            indent=2,
            ensure_ascii=False,
            default=str,
        ),
    )

    raw = structured_predict(llm, UserProfile, prompt)
    updated = raw if isinstance(raw, UserProfile) else UserProfile.model_validate(raw)
    # Enforce stable identifiers and aggregation metadata.
    updated = updated.model_copy(
        update={
            "user_id": user_id,
            "n_decisions_summarized": len(past_decisions),
        }
    )
    save_profile(updated)
    return updated


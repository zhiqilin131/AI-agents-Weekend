"""Shared wording: models must honor persisted user profile fields on ``UserState``."""

PROFILE_MUST_CONSIDER = (
    "User profile (shadow self): UserState includes profile_user_priorities (only what they typed in Profile), "
    "profile_clarification_priorities (structured multiple-choice answers), profile_memory_facts (short categorized "
    "facts: identity, views, behavior, …), profile_inferred_priorities (legacy one-line hints), profile_priorities "
    "(combined for convenience), profile_about_me, profile_constraints, and profile_values when saved. "
    "Treat Profile-authored priorities as firmer than inferred hints; prefer concrete memory facts over vague "
    "paraphrases. You MUST explicitly consider these fields alongside situational goals and evidence.\n\n"
)

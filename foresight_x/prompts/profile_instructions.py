"""Shared wording: models must honor persisted user profile fields on ``UserState``."""

PROFILE_MUST_CONSIDER = (
    "User profile (shadow self): UserState includes profile_priorities, profile_about_me, "
    "profile_constraints, and profile_values when the user has saved a profile. You MUST explicitly "
    "consider and weigh these fields alongside situational goals and evidence. If any profile field "
    "is non-empty, your reasoning and outputs must reflect it.\n\n"
)

"""Shared wording: models must honor persisted user profile fields on ``UserState``."""

PROFILE_MUST_CONSIDER = (
    "User profile (shadow self): UserState includes profile_user_priorities (authoritative), "
    "profile_inferred_priorities (system hints, may be wrong), profile_priorities (combined for convenience), "
    "profile_about_me, profile_constraints, and profile_values when the user has saved a profile. "
    "Treat user-stated priorities as firmer than inferred ones. You MUST explicitly consider these "
    "fields alongside situational goals and evidence.\n\n"
)

"""
Manually trigger a profile-summarization pass for the demo user.
Run: python -m scripts.update_profile

In v1 the profile is updated manually (or via cron). Auto-trigger on every Nth
decision is a v2 feature — don't add it yet.
"""

from __future__ import annotations

from foresight_x.config import load_settings
from foresight_x.memory.profile_summarizer import summarize_profile
from foresight_x.retrieval.memory import UserMemory


def main() -> None:
    settings = load_settings()
    user_id = settings.foresight_user_id

    mem = UserMemory(user_id=user_id, settings=settings)
    # Fallback remains intentionally explicit when the method is absent.
    past = mem.list_all_past_decisions() if hasattr(mem, "list_all_past_decisions") else []

    if not past:
        print(f"No past decisions found for user={user_id}. Seed memory first.")
        return

    profile = summarize_profile(user_id, past)
    print(f"\n=== Updated profile for {user_id} ===")
    print(f"Values: {profile.values}")
    print(f"Risk posture: {profile.risk_posture}")
    print(f"Themes: {profile.recurring_themes}")
    print(f"Confidence: {profile.confidence}")
    print(f"(Full profile at data/profiles/{user_id}.json)")


if __name__ == "__main__":
    main()


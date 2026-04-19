# Cursor Execution Prompt — Tier 3 Semantic User Profile

You are working on the Foresight-X repository. Read this entire prompt before writing code.

## Context

We are upgrading Foresight-X's memory architecture based on the 2024–2026 literature on agent memory (MemGPT, Generative Agents, A-MEM, Mem0). The current system has a single flat layer: Chroma vector store of past decisions. That's Tier 2 in the standard three-tier agent memory architecture. We are adding **Tier 3: a semantic user profile** that captures the user's values, risk posture, and recurring behavioral themes — the things that vector similarity over raw past decisions can never surface.

**Why this matters:** Vector retrieval finds decisions that look topically similar. It does NOT surface the user's underlying values or patterns. The semantic profile fills this gap by being a small, structured, LLM-summarized document that is ALWAYS included in the Recommender's context (unlike vector retrieval, which is conditional on similarity).

**Architecture target:**
```
Tier 1: Working Memory    — already exists (DecisionTrace for current decision)
Tier 2: Episodic Memory   — already exists (Chroma past decisions)
Tier 3: Semantic Profile  — THIS TASK (user values, themes, risk posture)
```

## Ground rules (read first, do not skip)

1. **Do not batch work.** One step, stop, verify, proceed. Wait for me to say "continue" between steps.

2. **Do not touch existing memory code unless a step explicitly requires it.** Tier 2 (`retrieval/memory.py`, the Chroma-backed past-decision store) must keep working exactly as it does now. We are ADDING Tier 3, not modifying Tier 2.

3. **Do not touch `schemas.py` existing models.** You will ADD a new `UserProfile` model. You will not modify `UserState`, `MemoryBundle`, `PastDecision`, or any other existing model. If you feel something in an existing schema should change, stop and report — do not silently edit.

4. **Do not add prompts outside `prompts.md`.** The profile-summarization prompt goes in `prompts.md` following the existing pattern. Cursor: before writing any prompt, re-read `prompts.md` to match its style.

5. **Do not change the wiring of any module other than the Recommender.** The only consumer of the semantic profile in v1 is the Recommender. Do not make the profile feed into Perception, Irrationality Detector, Option Generator, etc. — those can come later after we see whether v1 works.

6. **Do not run anything end-to-end yet.** We're shipping this as a scoped addition. Integration testing is a separate step after I review.

7. **After every step, print a status report** in this format:
   ```
   STEP X COMPLETE
   - files created: [...]
   - files modified: [...]
   - how I verified: [...]
   - notes / flags for review: [...]
   - next step: [...]
   ```
   Then wait for "continue".

---

## Execution plan

### STEP 1 — Survey (no writes)

Before any changes, report back:

1. Does `foresight_x/schemas.py` exist? Show me just the class names defined in it (one line each).
2. Show me the current signature of the Recommender's public function. Which module/file is it in? What arguments does it take?
3. Does `data/profiles/` directory exist? If not, flag that we'll need to create it.
4. Does `foresight_x/memory/` directory exist? If not, flag it. (Note: distinct from `foresight_x/retrieval/` which holds Tier 2.)
5. Is there any existing `UserProfile`, `Profile`, or `user_profile` symbol anywhere in the codebase? Grep and report.

Write zero files. Wait.

---

### STEP 2 — Add `UserProfile` schema

In `foresight_x/schemas.py`, ADD this new model at the end of the file. Do not modify any existing model.

```python
# ---------- Semantic User Profile (Tier 3 Memory) ----------

class UserProfile(BaseModel):
    """
    Tier 3 memory: a compact, LLM-summarized view of who the user is.
    Distinct from Tier 2 (episodic past decisions in Chroma) because:
    - Always loaded into Recommender context (not conditionally retrieved)
    - Structured, not free-form memory snippets
    - Captures values and patterns, not specific events
    """
    user_id: str
    values: list[str] = Field(
        default_factory=list,
        description="Stable values the user has revealed through past decisions. "
                    "E.g. 'long-term stability over short-term gain', 'autonomy', "
                    "'relationships over career advancement'."
    )
    risk_posture: Literal["risk-averse", "moderate", "risk-seeking", "unknown"] = "unknown"
    recurring_themes: list[str] = Field(
        default_factory=list,
        description="Behavioral patterns observed across past decisions. "
                    "E.g. 'tends to overcommit when excited', 'delays irreversible choices'."
    )
    current_goals: list[str] = Field(
        default_factory=list,
        description="Active goals the user is working toward, distilled from recent decisions."
    )
    known_constraints: list[str] = Field(
        default_factory=list,
        description="Stable constraints: time, money, obligations, health, location."
    )
    n_decisions_summarized: int = 0
    last_updated: str                     # ISO timestamp
    confidence: float = Field(ge=0, le=1, default=0.0)
    # Low confidence = profile built from few decisions; Recommender should weight it less.
```

After writing, verify: `python -c "from foresight_x.schemas import UserProfile; p = UserProfile(user_id='x', last_updated='2026-01-01'); print(p.model_dump())"` should print a valid default profile.

---

### STEP 3 — Profile storage module

Create `foresight_x/memory/` as a new package (with `__init__.py`). Then create `foresight_x/memory/profile_store.py`:

```python
# foresight_x/memory/profile_store.py
"""
Tier 3 Memory: persistent storage for the semantic user profile.
Stored as JSON on disk, one file per user. Separate from Chroma because profiles
are small, structured, and benefit from human inspection / debugging.
"""
from __future__ import annotations
import json
from datetime import datetime
from pathlib import Path
from foresight_x.config import DATA_DIR
from foresight_x.schemas import UserProfile

PROFILES_DIR = DATA_DIR / "profiles"
PROFILES_DIR.mkdir(parents=True, exist_ok=True)


def _profile_path(user_id: str) -> Path:
    # Reject anything that could escape the profiles dir
    if "/" in user_id or ".." in user_id:
        raise ValueError(f"Invalid user_id: {user_id!r}")
    return PROFILES_DIR / f"{user_id}.json"


def load_profile(user_id: str) -> UserProfile | None:
    """Load profile from disk, or None if it doesn't exist yet."""
    path = _profile_path(user_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return UserProfile(**data)
    except (json.JSONDecodeError, Exception) as e:
        # Corrupt profile — log and return None rather than crash
        print(f"[profile_store] failed to load profile for {user_id}: {e}")
        return None


def save_profile(profile: UserProfile) -> None:
    """Persist profile to disk. Overwrites existing."""
    profile.last_updated = datetime.utcnow().isoformat()
    path = _profile_path(profile.user_id)
    path.write_text(
        json.dumps(profile.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def empty_profile(user_id: str) -> UserProfile:
    """Cold-start default: an empty profile with unknown risk posture."""
    return UserProfile(
        user_id=user_id,
        last_updated=datetime.utcnow().isoformat(),
        confidence=0.0,
    )
```

Verify: `python -c "from foresight_x.memory.profile_store import empty_profile, save_profile, load_profile; p = empty_profile('test_user'); save_profile(p); p2 = load_profile('test_user'); print(p2.model_dump())"` should round-trip a profile through disk.

---

### STEP 4 — Add profile-summarization prompt to `prompts.md`

Open `prompts.md`. Add a new section **§10 Profile Summarizer** (before the existing "Change log" section). Use the same structure as other prompts in that file (Role / Objective / Constraints / Inputs). Use this exact content:

```
## 10. Profile Summarizer — `prompts/profile_summarizer.py`

**Purpose:** Given the user's past decisions (Tier 2) and their current profile (if any), produce an updated `UserProfile`.

**Schema:** `UserProfile`.

**When called:** Not on every decision. Called periodically — after every N new decisions (default N=5), or manually. This is the "reflection pass" from Generative Agents (Park et al. 2023).

ROLE
You are the Profile Summarizer of Foresight-X. Your job is to look across the user's
past decisions and distill a compact, structured profile: their values, risk posture,
recurring behavioral themes, current goals, and known constraints.

OBJECTIVE
Produce an UPDATED UserProfile that reflects what the past decisions reveal about this
person. If a prior profile exists, treat it as a prior — update it rather than overwriting,
and be conservative about changing long-standing values without strong evidence.

DISTILLATION RULES
- values: extract only STABLE preferences visible across multiple decisions. One decision
  is not evidence of a value. Two consistent decisions is weak evidence. Three+ is a value.
  Examples of good values: "prioritizes long-term stability over short-term gain",
  "values autonomy over compensation", "prefers reversible commitments".
  Bad values: "likes pizza", "chose Company X" (too specific — those are facts, not values).
- risk_posture: classify based on observed behavior, not user's self-description.
  "risk-averse" = consistently chooses safer option when trade-off is present.
  "risk-seeking" = consistently chooses higher-variance option.
  "moderate" = mixed.
  "unknown" = fewer than 3 past decisions with clear risk trade-offs.
- recurring_themes: behavioral patterns, not content topics. Good: "tends to overcommit
  when excited, then withdraws". Bad: "interested in tech careers" (that's content).
- current_goals: goals visible in the 3 most recent decisions. Omit goals that only
  appeared long ago unless they are still clearly active.
- known_constraints: stable, factual constraints (time, money, family obligations,
  health, location). Not values, not preferences — actual constraints.
- confidence: 0 = no data / empty profile. 0.3 = 3–5 decisions, initial patterns forming.
  0.6 = 6–15 decisions, reasonably established. 0.9 = 15+ with clear consistency.
  DO NOT exceed 0.9 — we should never be maximally confident about a person.

HARD CONSTRAINTS
- Do NOT invent values, themes, or goals not supported by the data.
- Do NOT write flattering or pop-psychology descriptions. This is a functional profile,
  not a personality assessment.
- Do NOT diagnose mental health conditions, personality disorders, or clinical patterns.
- Do NOT use MBTI, Enneagram, or other unvalidated frameworks. You may reference Big
  Five / OCEAN dimensions or Schwartz values if they are clearly warranted.
- If prior profile exists, preserve its values unless new decisions actively contradict
  them. Profile drift should be slow.
- If fewer than 3 past decisions are provided, set confidence ≤ 0.2 and populate fields
  sparsely. Do NOT over-extrapolate from one or two decisions.

Inputs
Prior profile (may be empty):
{prior_profile_json}

Past decisions (Tier 2 episodic memory, most recent first):
{past_decisions_json}
```

Do not create a Python file yet. Just update `prompts.md`.

---

### STEP 5 — Create `foresight_x/prompts/profile_summarizer.py`

Thin Python wrapper over the prompt text, matching the style of other files in `foresight_x/prompts/`:

```python
# foresight_x/prompts/profile_summarizer.py
"""
Source of truth: prompts.md §10 (Profile Summarizer)
Last synced: <today>
"""

PROFILE_SUMMARIZER_PROMPT = """
<copy the full prompt text from prompts.md §10, everything from "ROLE" through the end of the "Inputs" section>
"""
```

Keep the `{prior_profile_json}` and `{past_decisions_json}` placeholders as-is — they'll be populated via `.format()` by the caller.

---

### STEP 6 — Profile summarizer module

Create `foresight_x/memory/profile_summarizer.py`:

```python
# foresight_x/memory/profile_summarizer.py
"""
Periodic reflection pass: reads Tier 2 past decisions + prior profile, produces an
updated Tier 3 UserProfile via LLM structured_predict.
"""
from __future__ import annotations
import json
from foresight_x.config import get_llm
from foresight_x.harness.decision_logger import DecisionLogger
from foresight_x.schemas import UserProfile, PastDecision
from foresight_x.prompts.profile_summarizer import PROFILE_SUMMARIZER_PROMPT
from foresight_x.memory.profile_store import load_profile, save_profile, empty_profile


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
        llm = get_llm()

    log = DecisionLogger.current().module("profile_summarizer")
    log.start()

    prior = load_profile(user_id) or empty_profile(user_id)
    log.note(f"prior profile confidence={prior.confidence}, "
             f"n_previously_summarized={prior.n_decisions_summarized}")
    log.note(f"summarizing over {len(past_decisions)} past decisions")

    prompt = PROFILE_SUMMARIZER_PROMPT.format(
        prior_profile_json=json.dumps(prior.model_dump(), indent=2),
        past_decisions_json=json.dumps(
            [d.model_dump() for d in past_decisions], indent=2, default=str,
        ),
    )
    log.prompt(prompt)

    updated = llm.structured_predict(UserProfile, prompt)
    # The LLM might not preserve user_id correctly — enforce it.
    updated.user_id = user_id
    updated.n_decisions_summarized = len(past_decisions)

    save_profile(updated)
    log.output(
        values=updated.values,
        risk_posture=updated.risk_posture,
        themes=updated.recurring_themes,
        confidence=updated.confidence,
    )
    return updated
```

Verify: `python -c "from foresight_x.memory.profile_summarizer import summarize_profile; print('import ok')"`.

---

### STEP 7 — Wire profile into Recommender (minimal, isolated)

This is the only module-modification step. Find the Recommender's public function (from Step 1's survey).

Add the following, without removing any existing logic:

1. Import `load_profile` and `empty_profile` from `foresight_x.memory.profile_store`.
2. At the start of the Recommender function, after the `llm is None` guard, add:
   ```python
   from foresight_x.memory.profile_store import load_profile, empty_profile
   from foresight_x.config import USER_ID

   profile = load_profile(USER_ID) or empty_profile(USER_ID)
   ```
3. Pass `profile` into the prompt formatting. Add `{user_profile_json}` to the Recommender's prompt in `prompts.md` §7 (under "Inputs"), and update `prompts/recommender.py` to include the placeholder.
4. In the Recommender prompt, also add this instruction in the "SELECTION RULES" section:

   > - If `user_profile.confidence >= 0.3`, factor the user's values and risk_posture into the selection. For example: if profile says risk_posture="risk-averse" and options trade risk vs expected value, prefer the lower-risk option even at mild EV cost. If profile confidence is below 0.3, treat the profile as weakly informative and fall back to evidence + simulation.

5. In the Recommender's log output, add `log.note(f"profile confidence={profile.confidence}, used_profile={profile.confidence >= 0.3}")`.

**Do not** change the Recommender's return type or its other inputs. This should be an additive change only.

Report back the exact diff you applied. I will review before we proceed.

---

### STEP 8 — Manual trigger script

Create `scripts/update_profile.py`:

```python
"""
Manually trigger a profile-summarization pass for the demo user.
Run: python -m scripts.update_profile

In v1 the profile is updated manually (or via cron). Auto-trigger on every Nth
decision is a v2 feature — don't add it yet.
"""
from foresight_x.config import configure_llama_index_globals, USER_ID
from foresight_x.retrieval.memory import UserMemory
from foresight_x.memory.profile_summarizer import summarize_profile
from foresight_x.harness.decision_logger import DecisionLogger


def main():
    configure_llama_index_globals()
    dlog = DecisionLogger.start(f"profile-update-{USER_ID}")

    try:
        mem = UserMemory(user_id=USER_ID)
        # Load all past decisions. Adjust method name if UserMemory exposes differently.
        past = mem.list_all_past_decisions() if hasattr(mem, "list_all_past_decisions") \
               else []

        if not past:
            print(f"No past decisions found for user={USER_ID}. Seed memory first.")
            return

        profile = summarize_profile(USER_ID, past)
        print(f"\n=== Updated profile for {USER_ID} ===")
        print(f"Values: {profile.values}")
        print(f"Risk posture: {profile.risk_posture}")
        print(f"Themes: {profile.recurring_themes}")
        print(f"Confidence: {profile.confidence}")
        print(f"(Full profile at data/profiles/{USER_ID}.json)")
    finally:
        dlog.finish()


if __name__ == "__main__":
    main()
```

**Important:** if `UserMemory` doesn't currently have a `list_all_past_decisions()` method, flag this — don't add it silently. The fallback I've added will leave the profile empty, which is a visible failure mode, not a silent one.

---

### STEP 9 — Report for review

After Steps 1–8 complete, give me a summary report:

- All files created (full list)
- All files modified (with brief description of what changed in each)
- Any places where you had to improvise because the existing codebase didn't match assumptions
- Any flagged items that need my decision before we can actually test end-to-end
- What the next step would be (running `seed_memory` → `update_profile` → a trial decision that should now pull in the profile)

**Do not run anything end-to-end.** I will verify the integration separately.

---

## What this plan does NOT do

- Does **not** modify Tier 2 (existing Chroma past-decision memory). It stays exactly as it is.
- Does **not** add profile input to Perception, Irrationality Detector, Option Generator, Simulator, or Evaluator. Only Recommender consumes Tier 3 in v1.
- Does **not** auto-trigger profile updates. Manual only in v1.
- Does **not** add a time-decay / Ebbinghaus-style forgetting curve. Deferred to v2.
- Does **not** add importance scoring on past decisions. Deferred to v2.
- Does **not** add hierarchical graph memory (HippoRAG / A-MEM style). Deferred.
- Does **not** touch UI / Streamlit / frontend. The profile should be visible in logs and the profile JSON file for now.

These are all legitimate next steps but out of scope for this task. Do not add them.

---

## Start

Begin with **STEP 1 — Survey**. Report findings, then wait for "continue".

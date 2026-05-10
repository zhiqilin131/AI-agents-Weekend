"""Post-classify memory fact categories so Shadow + ingest share one rule set.

Only refines when the LLM chose ``other`` (conservative v1)."""

from __future__ import annotations

import re

from foresight_x.schemas import MemoryFactCategory

_FOOD_HABIT_PHRASES = (
    "likes to eat",
    "like to eat",
    "loves to eat",
    "love eating",
    "likes eating",
    "favorite food",
    "favourite food",
    "prefers to eat",
    "usually eats",
    "often eats",
    "typically eats",
    "food preference",
    "favorite meal",
    "favourite meal",
    "allergic to ",
    "vegetarian",
    "vegan",
    "doesn't eat",
    "dont eat",
    "don't eat",
    "avoid eating",
    "喜欢吃",
    "爱吃什么",
)

_IDENTITY_PREDICATES = frozenset(
    {
        "has_roommate",
        "roommate",
        "roommates",
        "friend",
        "friend_of",
        "girlfriend",
        "boyfriend",
        "spouse",
        "co_founder",
        "cofounder",
        "co-founder",
        "founder_with",
        "studies_at",
        "works_at",
        "lives_in",
        "name",
        "name_is",
        "preferred_name",
        "calls_self",
    }
)

# Affinity / fandom phrasing (not food — food handled first).
_AFFINITY_PHRASES = (
    "fan of",
    "big fan",
    "i'm a fan",
    "i am a fan",
    "im a fan",
    "root for",
    "cheer for",
    "season ticket",
    "球迷",
    "粉丝",
)

_SPORT_OR_CLUB_CUE = re.compile(
    r"(?i)\b("
    r"fc\b|f\.c\.|afc\b|cfc\b|cf\b|sc\b|ac milan|"
    r"football club|soccer|basketball team|"
    r"premier league|la liga|serie a|bundesliga|ligue 1|uefa|"
    r"champions league|world cup|nba|nfl|mlb|mls|"
    r"fc barcelona|barça|barca\b"
    r")\b"
)

_TEAM_OR_CLUB_NAMES = re.compile(
    r"(?i)\b("
    r"barcelona|real madrid|atletico|bayern|dortmund|psg|"
    r"juventus|milan|inter milan|inter\b|liverpool|"
    r"manchester united|manchester city|chelsea|arsenal|tottenham|"
    r"celtic|rangers|benfica|porto|ajax|feyenoord|"
    r"lakers|celtics|warriors|yankees|dodgers|patriots|cowboys"
    r")\b"
)

_LIKE_LOVE_PREFER = re.compile(r"(?i)\b(i like|i love|i prefer|i enjoy|i'm into|im into|we like|we love)\b")


def _normalize_predicate_key(predicate: str) -> str:
    p = (predicate or "").strip().lower().replace("-", "_")
    if p == "co_founder" or p == "cofounder":
        return "co_founder"
    return p


def _other_looks_like_behavior(blob: str) -> bool:
    if any(p in blob for p in _FOOD_HABIT_PHRASES):
        return True
    if re.search(r"\b(eats|eating|drinks|drinking)\b", blob) and re.search(
        r"\b(food|meal|breakfast|lunch|dinner|snack|coffee|tea|burger|burgers|pizza)\b", blob
    ):
        return True
    if re.search(r"(?i)\b(i like|i love|i enjoy|we like|we love)\b", blob) and re.search(
        r"\b(pizza|burger|burgers|sushi|tacos|ramen|pasta|chocolate|ice cream|snack|breakfast|lunch|dinner)\b", blob
    ):
        return True
    return False


def _other_looks_like_identity(blob: str, pred_key: str) -> bool:
    if pred_key in _IDENTITY_PREDICATES:
        return True
    if re.search(r"(?i)\b(has|have)\s+\d+\s+roommates?\b", blob):
        return True
    if re.search(r"(?i)\broommates?\s+(is|are)\s+named\b", blob):
        return True
    if re.search(r"(?i)\bone roommate\b", blob):
        return True
    if re.search(r"(?i)\b(co[- ]founder|co[- ]founders)\b", blob):
        return True
    if re.search(r"(?i)\bfriend of\b", blob) and not re.search(r"(?i)\bshould i\b", blob):
        return True
    return False


def _other_looks_like_views_affinity(blob: str) -> bool:
    if re.search(r"(?i)\b(i support|we support)\b", blob) and (
        _SPORT_OR_CLUB_CUE.search(blob) or _TEAM_OR_CLUB_NAMES.search(blob)
    ):
        return True
    if any(p in blob for p in _AFFINITY_PHRASES):
        if _SPORT_OR_CLUB_CUE.search(blob) or _TEAM_OR_CLUB_NAMES.search(blob):
            return True
        # Generic "fan of X" without sport cue still counts as stance/affinity.
        if "fan of" in blob or "big fan" in blob or "i'm a fan" in blob or "i am a fan" in blob or "im a fan" in blob:
            return True
    if _LIKE_LOVE_PREFER.search(blob):
        # Require sport/club cue so "I like burgers" stays behavior (handled earlier).
        if _SPORT_OR_CLUB_CUE.search(blob) or _TEAM_OR_CLUB_NAMES.search(blob):
            return True
    # Chinese: 喜欢 + team / ball sport
    if "喜欢" in blob and (
        "队" in blob or "球" in blob or "巴萨" in blob or "皇马" in blob or _TEAM_OR_CLUB_NAMES.search(blob)
    ):
        return True
    return False


def refine_memory_category(
    cat: MemoryFactCategory,
    *,
    text: str,
    evidence: str,
    predicate: str,
    subject_ref: str = "user",
) -> MemoryFactCategory:
    """If the model stored ``other``, map obvious lines to identity / views / behavior."""
    if cat != MemoryFactCategory.OTHER:
        return cat
    blob = f"{text}\n{evidence}\n{predicate}\n{subject_ref}".lower()
    pred_key = _normalize_predicate_key(predicate)

    if _other_looks_like_identity(blob, pred_key):
        return MemoryFactCategory.IDENTITY
    if _other_looks_like_behavior(blob):
        return MemoryFactCategory.BEHAVIOR
    if _other_looks_like_views_affinity(blob):
        return MemoryFactCategory.VIEWS
    return cat

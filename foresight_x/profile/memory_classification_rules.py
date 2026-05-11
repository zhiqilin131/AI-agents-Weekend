"""Deterministic ``MemoryFactCategory.OTHER`` → concrete bucket (fallback + tests).

Taxonomy (same as product schema):
  * **constraints** — hard limits the world imposes (health blocks, money caps, visas, custody, deadlines).
  * **goals** — future-directed outcomes the user is pursuing (degrees, offers, savings targets, habits they are *building toward*).
  * **identity** — stable biography / roles / relationships / institutions / names / whereabouts.
  * **views** — evaluative stance (politics, ethics-as-opinion, fandom, product/tech tribalism) — *not* mere food taste.
  * **behavior** — recurring patterns, habits, tastes, typical actions (including food preferences).
  * **other** — logistics, hedges, or nothing matched with confidence.

**Resolution order** (first match wins — tuned to reduce cross-tier bleed):
  1. Normalized ``predicate`` snake_case → category (strong structured signal).
  2. **constraints** cues in combined text (allergies, budget caps, authorization, immovable deadlines).
  3. **goals** cues (want to become, applying, saving for, training for, score X on).
  4. **identity** cues (I am a …, works at, my name, N roommates, demographics).
  5. **views** cues (I believe that …, political, team affinity without food).
  6. **behavior** cues (food, sleep chronotype, exercise cadence, procrastination style).
  7. **other**.
"""

from __future__ import annotations

import re
from typing import Final

from foresight_x.schemas import MemoryFactCategory

# ---------------------------------------------------------------------------
# Predicate → category (normalized snake_case keys)
# ---------------------------------------------------------------------------

_IDENTITY_PREDICATES: Final[frozenset[str]] = frozenset(
    {
        # household / social graph
        "has_roommate",
        "roommate",
        "roommates",
        "landlord",
        "lives_with",
        "household",
        "friend",
        "friend_of",
        "best_friend",
        "girlfriend",
        "boyfriend",
        "partner",
        "spouse",
        "wife",
        "husband",
        "fiance",
        "fiancee",
        "ex_partner",
        "co_parent",
        "parent",
        "parent_of",
        "mother_of",
        "father_of",
        "child",
        "child_of",
        "son",
        "daughter",
        "sibling",
        "sibling_of",
        "brother",
        "sister",
        "cousin_of",
        "uncle_of",
        "aunt_of",
        "grandparent_of",
        "pet",
        "has_pet",
        "dog_owner",
        "cat_owner",
        # work / school / org
        "studies_at",
        "student_at",
        "school",
        "university",
        "major",
        "minor",
        "degree",
        "class_year",
        "graduation_year",
        "works_at",
        "employed_at",
        "employer",
        "job_title",
        "role",
        "department",
        "team",
        "reports_to",
        "founder",
        "co_founder",
        "cofounder",
        "founder_with",
        "startup",
        # geography / legal personhood
        "lives_in",
        "resides_in",
        "from_city",
        "from_country",
        "nationality",
        "citizenship",
        "born_in",
        "hometown",
        "timezone",
        "zip_code",
        "postal_code",
        # names / labels
        "name",
        "name_is",
        "preferred_name",
        "nickname",
        "calls_self",
        "goes_by",
        "pronouns",
        "age",
        "date_of_birth",
        "birthday",
        # faith / community as stable affiliation (biography — not a policy opinion)
        "religion",
        "denomination",
        "congregation",
    }
)

_CONSTRAINT_PREDICATES: Final[frozenset[str]] = frozenset(
    {
        "allergic_to",
        "allergy",
        "food_allergy",
        "intolerance",
        "dietary_restriction",
        "medical_condition",
        "disability",
        "accommodation",
        "prescription",
        "cannot_eat",
        "must_avoid",
        "budget_cap",
        "max_budget",
        "monthly_budget",
        "income_limit",
        "debt",
        "loan_payment",
        "visa_status",
        "work_authorization",
        "work_permit",
        "green_card",
        "citizenship_barrier",
        "non_compete",
        "custody",
        "court_order",
        "probation",
        "security_clearance",
        "deadline",
        "hard_deadline",
        "immovable_date",
        "blackout_dates",
        "non_negotiable",
    }
)

_GOAL_PREDICATES: Final[frozenset[str]] = frozenset(
    {
        "goal",
        "career_goal",
        "life_goal",
        "wants_to",
        "aspires_to",
        "target",
        "target_role",
        "target_school",
        "target_company",
        "applying_to",
        "application_deadline",
        "interviewing_at",
        "seeking_offer",
        "promotion_goal",
        "salary_target",
        "savings_goal",
        "saving_for",
        "exam_goal",
        "score_target",
        "certification_goal",
        "learning_goal",
        "skill_goal",
        "race_goal",
        "marathon",
        "weight_goal",
        "language_goal",
        "relocation_plan",
    }
)

_VIEW_PREDICATES: Final[frozenset[str]] = frozenset(
    {
        "believes",
        "belief",
        "opinion",
        "stance",
        "political_affiliation",
        "party_preference",
        "supports_policy",
        "opposes_policy",
        "ethical_view",
        "values_statement",
        "worldview",
        "fandom",
        "team_affinity",
        "prefers_candidate",
        "voting_plan",
        "climate_stance",
        "religious_view",
        "philosophical_view",
    }
)

_BEHAVIOR_PREDICATES: Final[frozenset[str]] = frozenset(
    {
        "habit",
        "routine",
        "usually",
        "often",
        "typically",
        "tends_to",
        "avoids_doing",
        "sleep_pattern",
        "chronotype",
        "exercise_habit",
        "diet_habit",
        "substance_use",
        "procrastination_style",
        "work_style",
        "communication_style",
        "shopping_habit",
        "gaming_habit",
        "media_habit",
        "travel_style",
    }
)


def _normalize_predicate_key(predicate: str) -> str:
    p = (predicate or "").strip().lower().replace("-", "_")
    if p in ("co_founder", "cofounder"):
        return "co_founder"
    return p


def _predicate_stem_hit(pred_key: str, stem: str) -> bool:
    """True when ``stem`` is a whole snake segment of ``pred_key`` (reduces substring false positives)."""
    if not stem or not pred_key:
        return False
    if pred_key == stem:
        return True
    if pred_key.startswith(f"{stem}_"):
        return True
    if pred_key.endswith(f"_{stem}"):
        return True
    return f"_{stem}_" in pred_key


def _category_from_predicate(pred_key: str) -> MemoryFactCategory | None:
    if not pred_key:
        return None
    if pred_key in _CONSTRAINT_PREDICATES:
        return MemoryFactCategory.CONSTRAINTS
    if pred_key in _GOAL_PREDICATES:
        return MemoryFactCategory.GOALS
    if pred_key in _VIEW_PREDICATES:
        return MemoryFactCategory.VIEWS
    if pred_key in _BEHAVIOR_PREDICATES:
        return MemoryFactCategory.BEHAVIOR
    if pred_key in _IDENTITY_PREDICATES:
        return MemoryFactCategory.IDENTITY

    for prefixes, cat in (
        (
            (
                "support_",
                "supports_",
                "oppose_",
                "opposes_",
                "belief_",
                "believes_",
                "stance_",
                "fandom_",
            ),
            MemoryFactCategory.VIEWS,
        ),
        (
            (
                "allergic_",
                "allergy_",
                "visa_",
                "budget_",
                "deadline_",
                "custody_",
                "medical_",
                "disability_",
            ),
            MemoryFactCategory.CONSTRAINTS,
        ),
        (
            ("goal_", "target_", "apply_", "aspire_", "saving_", "training_", "exam_"),
            MemoryFactCategory.GOALS,
        ),
        (
            ("co_founder_", "founder_", "startup_", "employer_", "job_title_", "studies_at_", "works_at_"),
            MemoryFactCategory.IDENTITY,
        ),
    ):
        if any(pred_key.startswith(p) for p in prefixes):
            return cat

    for stem, cat in (
        ("allergic", MemoryFactCategory.CONSTRAINTS),
        ("budget", MemoryFactCategory.CONSTRAINTS),
        ("visa", MemoryFactCategory.CONSTRAINTS),
        ("deadline", MemoryFactCategory.CONSTRAINTS),
        ("custody", MemoryFactCategory.CONSTRAINTS),
        ("medical", MemoryFactCategory.CONSTRAINTS),
        ("goal", MemoryFactCategory.GOALS),
        ("aspir", MemoryFactCategory.GOALS),
        ("apply", MemoryFactCategory.GOALS),
        ("saving", MemoryFactCategory.GOALS),
        ("train", MemoryFactCategory.GOALS),
        ("believ", MemoryFactCategory.VIEWS),
        ("stance", MemoryFactCategory.VIEWS),
        ("opinion", MemoryFactCategory.VIEWS),
        ("fan", MemoryFactCategory.VIEWS),
        ("habit", MemoryFactCategory.BEHAVIOR),
        ("tend", MemoryFactCategory.BEHAVIOR),
        ("usually", MemoryFactCategory.BEHAVIOR),
        ("studies", MemoryFactCategory.IDENTITY),
        ("works_", MemoryFactCategory.IDENTITY),
        ("lives_", MemoryFactCategory.IDENTITY),
        ("employ", MemoryFactCategory.IDENTITY),
        ("roommate", MemoryFactCategory.IDENTITY),
        ("friend", MemoryFactCategory.IDENTITY),
        ("spouse", MemoryFactCategory.IDENTITY),
        ("child", MemoryFactCategory.IDENTITY),
        ("parent", MemoryFactCategory.IDENTITY),
        ("name", MemoryFactCategory.IDENTITY),
    ):
        if _predicate_stem_hit(pred_key, stem):
            return cat
    return None


# ---------------------------------------------------------------------------
# Blob cues (text + evidence + predicate + subject, lowercased)
# ---------------------------------------------------------------------------

_RE_CONSTRAINTS = re.compile(
    r"(?is)"
    r"\b("
    r"allergic to|anaphylaxis|food allergy|peanut allergy|nut allergy|lactose intolerant|gluten[- ]?free|"
    r"celiac|must avoid|can't eat|cannot eat|can\x27t eat|"
    r"doctor said no|medically (?:advised|forbidden|restricted)|"
    r"prescription says|on medication for|"
    r"can\x27t afford|cannot afford|barely afford|max budget|budget cap|monthly cap|hard cap|"
    r"non-negotiable deadline|immovable deadline|visa expires|visa runs out|work authorization|"
    r"work permit|no work permit|lost (?:my )?job authorization|"
    r"custody agreement|court order|probation|restraining order|"
    r"security clearance (?:denied|revoked)|clearance denied|"
    r"disability (?:prevents|means)|need accommodation|ada accommodation|"
    r"blackout dates|cannot travel (?:on|during)|"
    r"财务压力|预算有限|过敏|不能吃|医嘱|签证到期"
    r")\b"
)

# Avoid "I want to tell you" / "need to go" — anchor goal verbs / nouns.
_RE_GOALS = re.compile(
    r"(?is)"
    r"\b("
    r"my goal is|our goal is|career goal|life goal|north star|"
    r"(?:i|we)\s+(?:want|wanna|would like|hope|plan|aim|intend)\s+to\s+(?:"
    r"get|become|land|secure|finish|pass|"
    r"earn|save|buy|move|start|quit|switch|break into|break in to|pivot into|transition to|"
    r"learn|master|study for|prepare for|apply to|get into|get accepted|interview at|"
    r"raise|grow|scale|launch|ship|publish|graduate|get promoted|get a promotion|"
    r"lose weight|gain muscle|run a marathon|run the marathon|"
    r"reach \$|save \$|save up|saving for|saving toward|"
    r"目标|打算|想考上|想进|想拿|想转行"
    r")|"
    r"score (?:a )?\d{2,3}\s*(?:on|in)\s*(?:the )?(?:mcat|lsat|gre|gmat|sat|act|toefl|ielts)|"
    r"get (?:my |the )?(?:cfa|cpa|pmp)|pass (?:the )?bar"
    r")\b"
)

_RE_IDENTITY = re.compile(
    r"(?is)"
    r"\b("
    r"(?:i\x27m|i am|i’m)\s+(?:a|an)\s+(?:student|undergrad|graduate student|phd student|postdoc|"
    r"software engineer|swe|data scientist|pm|product manager|designer|nurse|doctor|teacher|"
    r"lawyer|attorney|accountant|founder|ceo|cto|cfo|intern|parent|father|mother|dad|mom|"
    r"single parent|stay-at-home|stay at home)\b|"
    r"\b(i work at|i work for|i\x27m employed at|employed at|my employer is|my office is at)|"
    r"\b(i study at|i go to|i attend|enrolled at|student at)\b|"
    r"\b(my name is|call me |calls (?:himself|herself)|goes by the name|preferred name is)|"
    r"\b(i live in|living in|based in|from (?:the )?(?:town|city|state|country|province) of)|"
    r"\b(i\x27m from|i am from|originally from|raised in|grew up in)|"
    r"\b(i have|i\x27ve got|there are)\s+\d+\s+room\s*mates?\b|"
    r"\b(?:has|have)\s+\d+\s+room\s*mates?\b|"
    r"\b(?:user|they|subject)\s+has\s+\d+\s+room\s*mates?\b|"
    r"\broom\s*mates?\s+(?:is|are)\s+named\b|"
    r"\bone room\s*mate\b|"
    r"\b(co[- ]founder|co[- ]founders)\b|"
    r"\bfriend of\b(?![\s\S]{0,40}\bshould i\b)|"  # "friend of Alice" not "friend of the court should I"
    r"\b(age\s*\d{1,3}|turning\s+\d{1,3}|born in (?:19|20)\d{2})\b|"
    r"\b(i\x27m|i am)\s+(?:catholic|christian|muslim|jewish|buddhist|hindu|sikh|atheist|agnostic)\b|"
    r"\b(pronouns are|my pronouns)\b|"
    r"\b(我是|我在|我读于|毕业于|住在)"
    r")\b"
)

_RE_VIEWS = re.compile(
    r"(?is)"
    r"\b("
    r"i believe that|we believe that|i think (?:that )?(?:the |this |we |government|policy|law)|"
    r"politically i|my politics|political view|"
    r"i (?:support|oppose) (?:the )?(?:policy|bill|law|tax (?:cut|hike)|candidate|party platform)|"
    r"(?:strongly )?(?:support|oppose) (?:abortion|immigration reform|climate)\b|"
    r"\b(i support|we support)\b(?=[\s\S]{0,120}(?:fc\b|f\.c\.|afc|premier league|nba|nfl|mlb|soccer|football club|"
    r"champions league|world cup|barcelona|liverpool|manchester|chelsea|arsenal|lakers|celtics|warriors|"
    r"队|球|球迷|粉丝))|"
    r"\b(fan of|big fan|i\x27m a fan|i am a fan|im a fan|root for|cheer for|season ticket holder)\b|"
    r"\b(i like|i love|i prefer|i enjoy|i\x27m into|im into|we like|we love)\b"
    r"(?=[\s\S]{0,80}\b("
    r"fc\b|f\.c\.|afc|premier league|nba|nfl|mlb|soccer|football club|barcelona|liverpool|manchester|"
    r"chelsea|arsenal|lakers|celtics|warriors|yankees|dodgers|patriots|cowboys|队|球|巴萨|皇马"
    r"))|"
    r"喜欢(?:.{0,20})(?:队|球|巴萨|皇马)"
    r")\b"
)

_FOOD_HABIT_PHRASES: Final[tuple[str, ...]] = (
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
    "favorite cuisine",
    "favourite cuisine",
    "allergic to ",  # also constraint — caught earlier by _RE_CONSTRAINTS when "allergic to"
    "vegetarian",
    "vegan",
    "pescatarian",
    "keto",
    "halal",
    "kosher",
    "doesn't eat",
    "dont eat",
    "don't eat",
    "avoid eating",
    "cutting out sugar",
    "trying intermittent fasting",
    "喜欢吃",
    "爱吃什么",
    "不爱吃",
)

_FOOD_TOKENS = re.compile(
    r"(?is)\b("
    r"pizza|burger|burgers|sushi|tacos|ramen|pasta|pho|curry|"
    r"chocolate|ice cream|snack|breakfast|lunch|dinner|brunch|"
    r"coffee|tea|latte|espresso|beer|wine|whiskey|"
    r"salad|steak|chicken|fish|seafood|dessert|"
    r"火锅|烧烤|奶茶|咖啡"
    r")\b"
)

_RE_BEHAVIOR_BODY = re.compile(
    r"(?is)"
    r"\b("
    r"eats|eating|drinks|drinking|snacks on|usually cooks|meal prep|"
    r"night owl|early bird|insomniac|sleep at \d|wake(?:s)? up at|"
    r"go(?:es)? to (?:the )?gym|work(?:s)? out|runs (?:\d+|daily|weekly)|jogs|yoga|pilates|peloton|"
    r"procrastinate|last[- ]minute|deep work|time[- ]block|"
    r"binge watch|netflix|scroll(?:s)? (?:instagram|tiktok|twitter|x\b)|"
    r"social battery|introvert|extrovert|ambivert|"
    r"通勤|熬夜|早起|健身|拖延"
    r")\b"
)


def _blob_constraints(blob: str) -> bool:
    return bool(_RE_CONSTRAINTS.search(blob))


def _blob_goals(blob: str) -> bool:
    return bool(_RE_GOALS.search(blob))


def _blob_identity(blob: str, pred_key: str) -> bool:
    if _RE_IDENTITY.search(blob):
        return True
    if re.search(r"(?i)\b(has|have)\s+\d+\s+room\s*mates?\b", blob):
        return True
    if re.search(r"(?i)\broom\s*mates?\s+(is|are)\s+named\b", blob):
        return True
    if re.search(r"(?i)\bone room\s*mate\b", blob):
        return True
    if re.search(r"(?i)\b(co[- ]founder|co[- ]founders)\b", blob):
        return True
    if re.search(r"(?i)\bfriend of\b", blob) and not re.search(r"(?i)\bshould i\b", blob):
        return True
    return False


def _blob_views(blob: str) -> bool:
    return bool(_RE_VIEWS.search(blob))


def _blob_behavior(blob: str) -> bool:
    if any(p in blob for p in _FOOD_HABIT_PHRASES):
        return True
    if re.search(r"\b(eats|eating|drinks|drinking)\b", blob) and _FOOD_TOKENS.search(blob):
        return True
    if re.search(r"(?i)\b(i like|i love|i enjoy|we like|we love)\b", blob) and _FOOD_TOKENS.search(blob):
        return True
    if _RE_BEHAVIOR_BODY.search(blob) and not _RE_GOALS.search(blob):
        # e.g. "go to gym" without "want to start going" goal phrasing
        return True
    return False


def refine_other_with_rules(
    *,
    text: str,
    evidence: str,
    predicate: str,
    subject_ref: str,
) -> MemoryFactCategory:
    """Map ``OTHER`` using predicate-first, then ordered blob heuristics."""
    blob = f"{text}\n{evidence}\n{predicate}\n{subject_ref}".lower()
    pred_key = _normalize_predicate_key(predicate)

    pc = _category_from_predicate(pred_key)
    if pc is not None:
        return pc

    if _blob_constraints(blob):
        return MemoryFactCategory.CONSTRAINTS
    if _blob_goals(blob):
        return MemoryFactCategory.GOALS
    if _blob_identity(blob, pred_key):
        return MemoryFactCategory.IDENTITY
    if _blob_views(blob):
        return MemoryFactCategory.VIEWS
    if _blob_behavior(blob):
        return MemoryFactCategory.BEHAVIOR
    return MemoryFactCategory.OTHER

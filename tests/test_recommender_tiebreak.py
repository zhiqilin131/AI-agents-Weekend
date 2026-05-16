from __future__ import annotations

from foresight_x.decision.recommender import composite_score, recommend, DEFAULT_EVALUATION_WEIGHTS
from foresight_x.schemas import (
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    Reversibility,
    TimePressure,
    UserState,
)


def _state(question: str) -> UserState:
    return UserState(
        raw_input=question,
        goals=["enjoy the experience"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=5,
        workload=5,
        current_behavior="deciding",
        decision_type="personal",
        reversibility=Reversibility.PARTIAL,
    )


def test_tied_composite_prefers_question_relevant_option() -> None:
    """Identical scores must not always default to opt_ask_extension (list order)."""
    st = _state("Should I go to the NBA playoffs or the Drake performance?")
    mem = MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary="")
    ev = EvidenceBundle(facts=[], base_rates=[], recent_events=[])
    options = [
        Option(
            option_id="opt_ask_extension",
            name="Ask for more time",
            description="Delay the decision.",
            key_assumptions=[],
            cost_of_reversal="low",
        ),
        Option(
            option_id="opt_choice_drake",
            name="Choose: Drake performance",
            description="Go to the Drake concert.",
            key_assumptions=[],
            cost_of_reversal="medium",
        ),
        Option(
            option_id="opt_choice_nba",
            name="Choose: NBA playoffs",
            description="Attend the NBA playoffs.",
            key_assumptions=[],
            cost_of_reversal="medium",
        ),
    ]
    tied_eval = OptionEvaluation(
        option_id="x",
        expected_value_score=6.0,
        risk_score=3.0,
        regret_score=3.0,
        uncertainty_score=5.0,
        goal_alignment_score=7.0,
        rationale="",
    )
    evaluations = [
        tied_eval.model_copy(update={"option_id": o.option_id}) for o in options
    ]
    scores = {o.option_id: composite_score(e, DEFAULT_EVALUATION_WEIGHTS) for o, e in zip(options, evaluations)}
    assert len(set(scores.values())) == 1

    rec = recommend(evaluations, options, ev, mem, user_state=st, llm=None)
    assert rec.chosen_option_id != "opt_ask_extension"
    assert rec.chosen_option_id in {"opt_choice_drake", "opt_choice_nba"}

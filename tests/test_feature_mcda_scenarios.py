"""Functional scenario tests: run full simulate → feature → score → recommend pipeline.

Each case defines a realistic decision, runs the deterministic engine end-to-end,
and asserts on concrete scores, feature vectors, futures gate, and winner — not
just schema/shape checks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pytest

from foresight_x.decision.recommender import DEFAULT_EVALUATION_WEIGHTS, composite_score, recommend
from foresight_x.schemas import (
    EvidenceBundle,
    Fact,
    MemoryBundle,
    Option,
    OptionEvaluation,
    OptionTradeoffTags,
    Reversibility,
    TimePressure,
    UserState,
)
from foresight_x.simulation.evaluator import evaluate_options_from_features
from foresight_x.simulation.feature_extractor import extract_features_for_options
from foresight_x.simulation.feature_schemas import FutureReliabilityReport, OptionFeatureVector
from foresight_x.simulation.future_reliability import assess_futures_reliability
from foresight_x.simulation.future_simulator import simulate_futures


@dataclass
class ScenarioRun:
    """Full pipeline output for one decision case."""

    name: str
    user_state: UserState
    options: list[Option]
    evidence: EvidenceBundle
    memory: MemoryBundle
    feature_vectors: list[OptionFeatureVector]
    evaluations: list[OptionEvaluation]
    reliability: dict[str, FutureReliabilityReport]
    composite_by_id: dict[str, float]
    winner_id: str
    recommendation_reasoning: str


@dataclass
class DecisionCase:
    name: str
    user_state: UserState
    options: list[Option]
    evidence: EvidenceBundle
    memory: MemoryBundle = field(
        default_factory=lambda: MemoryBundle(
            similar_past_decisions=[],
            behavioral_patterns=[],
            prior_outcomes_summary="",
        )
    )
    expected_winner: str = ""
    checks: list[Callable[[ScenarioRun], None]] = field(default_factory=list)


def _by_id(items: list, key: str = "option_id") -> dict:
    return {getattr(x, key): x for x in items}


def run_decision_case(case: DecisionCase) -> ScenarioRun:
    """Execute simulate → extract → reliability gate → score → recommend."""
    futures = simulate_futures(case.options, case.user_state, case.evidence, llm=None, memory=case.memory)
    fvs = extract_features_for_options(case.options, case.user_state, case.evidence, case.memory)
    rel = assess_futures_reliability(futures, case.options, case.user_state, case.evidence)
    evals = evaluate_options_from_features(
        case.options, case.user_state, case.evidence, case.memory, futures=futures
    )
    rec = recommend(evals, case.options, case.evidence, case.memory, user_state=case.user_state, llm=None)
    composite = {e.option_id: composite_score(e, DEFAULT_EVALUATION_WEIGHTS) for e in evals}
    return ScenarioRun(
        name=case.name,
        user_state=case.user_state,
        options=case.options,
        evidence=case.evidence,
        memory=case.memory,
        feature_vectors=fvs,
        evaluations=evals,
        reliability=rel,
        composite_by_id=composite,
        winner_id=rec.chosen_option_id,
        recommendation_reasoning=rec.reasoning,
    )


def _score(run: ScenarioRun, oid: str) -> OptionEvaluation:
    return _by_id(run.evaluations)[oid]


def _fv(run: ScenarioRun, oid: str) -> OptionFeatureVector:
    return _by_id(run.feature_vectors)[oid]


# ---------------------------------------------------------------------------
# Scenario fixtures (realistic decision cases)
# ---------------------------------------------------------------------------

CASE_THESIS_DEADLINE = DecisionCase(
    name="burned_out_thesis_deadline",
    user_state=UserState(
        raw_input="Thesis deadline Friday — sprint finish or ask for extension?",
        goals=["finish thesis", "sleep", "quality work"],
        time_pressure=TimePressure.HIGH,
        stress_level=9,
        workload=8,
        current_behavior="panicking",
        decision_type="academic",
        reversibility=Reversibility.PARTIAL,
        deadline_hint="Friday",
        profile_constraints=["must submit before graduation"],
    ),
    options=[
        Option(
            option_id="sprint",
            name="Sprint commit now",
            description="All-in 48-hour sprint with no breaks to submit tonight.",
            key_assumptions=["can finish in time"],
            cost_of_reversal="high",
            tradeoff_tags=OptionTradeoffTags(
                time_cost_level="high",
                stress_load_level="high",
                workload_level="high",
                downside_severity_level="high",
                tag_confidence=0.85,
                tag_source="template",
            ),
        ),
        Option(
            option_id="extension",
            name="Ask for extension",
            description="Request one week extension from advisor to delay the deadline.",
            key_assumptions=["advisor agrees"],
            cost_of_reversal="low",
        ),
    ],
    evidence=EvidenceBundle(
        facts=[Fact(text="Extensions granted 60% of the time in this department.", confidence=0.6)],
        base_rates=[],
        recent_events=[],
    ),
    expected_winner="extension",
)

CASE_CAREER_REMOTE = DecisionCase(
    name="career_remote_vs_hybrid",
    user_state=UserState(
        raw_input="Should I accept the remote offer or counter for hybrid?",
        goals=["career growth", "work-life balance"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=4,
        workload=5,
        current_behavior="calm analysis",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    ),
    options=[
        Option(
            option_id="accept",
            name="Accept remote offer",
            description="Start remote role with growth upside and promotion path.",
            key_assumptions=["manager support"],
            cost_of_reversal="medium",
            tradeoff_tags=OptionTradeoffTags(
                upside_potential_level="high",
                goal_alignment_level="high",
                money_cost_level="medium",
                stress_load_level="low",
                workload_level="medium",
                tag_confidence=0.85,
                tag_source="template",
            ),
        ),
        Option(
            option_id="counter",
            name="Counter on hybrid",
            description="Negotiate hybrid schedule with manageable workload and flexibility.",
            key_assumptions=["flexibility exists"],
            cost_of_reversal="low",
            tradeoff_tags=OptionTradeoffTags(
                upside_potential_level="medium",
                goal_alignment_level="medium",
                stress_load_level="low",
                workload_level="low",
                reversibility_level="high",
                tag_confidence=0.85,
                tag_source="template",
            ),
        ),
    ],
    evidence=EvidenceBundle(
        facts=[Fact(text="Remote roles widen talent pools and support career growth.", confidence=0.75)],
        base_rates=[],
        recent_events=[],
    ),
    expected_winner="accept",
)

CASE_SPARSE_INFO = DecisionCase(
    name="sparse_info_vague_options",
    user_state=UserState(
        raw_input="Should I do something?",
        goals=["figure it out"],
        time_pressure=TimePressure.LOW,
        stress_level=5,
        workload=5,
        current_behavior="unsure",
        decision_type="unknown",
        reversibility=Reversibility.PARTIAL,
    ),
    options=[
        Option(option_id="vague_a", name="Option A", description="Do the thing.", key_assumptions=[], cost_of_reversal="medium"),
        Option(option_id="vague_b", name="Option B", description="Do the other thing.", key_assumptions=[], cost_of_reversal="medium"),
    ],
    evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
)

CASE_QUIT_VS_SABBATICAL = DecisionCase(
    name="quit_vs_sabbatical",
    user_state=UserState(
        raw_input="Burned out — quit immediately or request sabbatical?",
        goals=["mental health", "financial stability"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=8,
        workload=7,
        current_behavior="exhausted",
        decision_type="career",
        reversibility=Reversibility.IRREVERSIBLE,
        profile_constraints=["need income for 6 months"],
    ),
    options=[
        Option(
            option_id="quit",
            name="Quit immediately",
            description="Irreversible resignation with risky downside and no income.",
            key_assumptions=["new job within 2 months"],
            cost_of_reversal="high",
            tradeoff_tags=OptionTradeoffTags(
                stress_load_level="high",
                downside_severity_level="high",
                money_cost_level="high",
                tag_confidence=0.85,
                tag_source="template",
            ),
        ),
        Option(
            option_id="sabbatical",
            name="Request sabbatical",
            description="Reversible pause with low stress and manageable workload recovery path.",
            key_assumptions=["employer allows sabbatical"],
            cost_of_reversal="low",
        ),
    ],
    evidence=EvidenceBundle(
        facts=[Fact(text="Sabbaticals preserve benefits in 40% of companies.", confidence=0.5)],
        base_rates=[],
        recent_events=[],
    ),
    expected_winner="sabbatical",
)

ALL_CASES = [CASE_THESIS_DEADLINE, CASE_CAREER_REMOTE, CASE_SPARSE_INFO, CASE_QUIT_VS_SABBATICAL]


# ---------------------------------------------------------------------------
# Per-scenario functional checks
# ---------------------------------------------------------------------------


def check_thesis_deadline(run: ScenarioRun) -> None:
    sprint = _score(run, "sprint")
    ext = _score(run, "extension")
    sprint_fv = _fv(run, "sprint")

    assert run.winner_id == "extension"
    assert run.composite_by_id["extension"] > run.composite_by_id["sprint"]
    assert sprint.expected_value_score < ext.expected_value_score
    assert sprint.risk_score >= ext.risk_score
    assert sprint.regret_score > ext.regret_score
    assert "high_stress_path_while_user_stressed" in sprint_fv.hard_constraint_violations
    assert sprint_fv.downside_severity_level == "high"
    assert sprint_fv.reversibility_level == "low"
    assert _fv(run, "extension").reversibility_level == "high"
    assert sprint.expected_value_score <= 1.0


def check_career_remote(run: ScenarioRun) -> None:
    accept = _score(run, "accept")
    counter = _score(run, "counter")
    accept_fv = _fv(run, "accept")
    counter_fv = _fv(run, "counter")

    assert run.winner_id == "accept"
    assert run.composite_by_id["accept"] > run.composite_by_id["counter"]
    assert accept.expected_value_score > counter.expected_value_score
    assert accept.goal_alignment_score >= counter.goal_alignment_score
    assert accept_fv.upside_potential_level == "high"
    assert accept_fv.missing_critical_info_count < counter_fv.missing_critical_info_count
    for oid, rep in run.reliability.items():
        assert rep.score_use == "score_eligible"
        assert rep.grounding_coverage >= 0.5
        assert "expected_value_score" in rep.blocked_uses


def check_sparse_info(run: ScenarioRun) -> None:
    for e in run.evaluations:
        assert e.uncertainty_score >= 8.5, f"{e.option_id} uncertainty should reflect sparse inputs"
        assert e.expected_value_score < 5.0
    for fv in run.feature_vectors:
        assert fv.missing_critical_info_count >= 3
        assert fv.upside_potential_level == "unknown"
    for rep in run.reliability.values():
        assert rep.score_use == "explanation_only"
        assert rep.grounding_coverage == 0.0
        assert "expected_value_score" in rep.blocked_uses
    # Tie on composite — engine picks one deterministically
    assert abs(run.composite_by_id["vague_a"] - run.composite_by_id["vague_b"]) < 0.01


def check_quit_vs_sabbatical(run: ScenarioRun) -> None:
    quit = _score(run, "quit")
    sabb = _score(run, "sabbatical")
    quit_fv = _fv(run, "quit")
    sabb_fv = _fv(run, "sabbatical")

    assert run.winner_id == "sabbatical"
    assert run.composite_by_id["sabbatical"] > run.composite_by_id["quit"]
    assert quit.risk_score > sabb.risk_score
    assert quit.regret_score > sabb.regret_score
    assert quit.expected_value_score < sabb.expected_value_score
    assert quit_fv.reversibility_level == "low"
    assert quit_fv.downside_severity_level == "high"
    assert sabb_fv.reversibility_level == "high"
    assert sabb_fv.stress_load_level == "low"
    assert "high_stress_path_while_user_stressed" in quit_fv.hard_constraint_violations


CASE_CHECKS: dict[str, Callable[[ScenarioRun], None]] = {
    "burned_out_thesis_deadline": check_thesis_deadline,
    "career_remote_vs_hybrid": check_career_remote,
    "sparse_info_vague_options": check_sparse_info,
    "quit_vs_sabbatical": check_quit_vs_sabbatical,
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", ALL_CASES, ids=[c.name for c in ALL_CASES])
def test_scenario_end_to_end_output(case: DecisionCase) -> None:
    """Run a full decision case and assert on scores, features, and winner."""
    run = run_decision_case(case)
    if case.expected_winner:
        assert run.winner_id == case.expected_winner, (
            f"Expected winner {case.expected_winner}, got {run.winner_id}. "
            f"Composites: {run.composite_by_id}"
        )
    CASE_CHECKS[case.name](run)


def test_scenario_scorecard_reproducible() -> None:
    """Same case run twice yields identical scorecard (deterministic engine)."""
    a = run_decision_case(CASE_CAREER_REMOTE)
    b = run_decision_case(CASE_CAREER_REMOTE)
    assert a.winner_id == b.winner_id
    assert a.composite_by_id == b.composite_by_id
    assert [e.model_dump() for e in a.evaluations] == [e.model_dump() for e in b.evaluations]


def test_weak_futures_only_bump_uncertainty_in_scenario() -> None:
    """In sparse case, simulated futures must not inflate EV/Risk/Regret."""
    case = CASE_SPARSE_INFO
    futures = simulate_futures(case.options, case.user_state, case.evidence, llm=None)
    without = evaluate_options_from_features(case.options, case.user_state, case.evidence, futures=None)
    with_fut = evaluate_options_from_features(
        case.options, case.user_state, case.evidence, futures=futures
    )
    by_without = _by_id(without)
    by_with = _by_id(with_fut)
    for oid in by_without:
        w, f = by_without[oid], by_with[oid]
        assert f.uncertainty_score >= w.uncertainty_score - 0.01
        assert f.expected_value_score <= w.expected_value_score + 0.01
        assert f.risk_score >= w.risk_score - 0.01
        assert f.regret_score >= w.regret_score - 0.01


def test_print_scenario_scorecard(capsys: pytest.CaptureFixture[str]) -> None:
    """Human-readable scorecard dump for manual inspection (`pytest -s -k scorecard`)."""
    for case in ALL_CASES:
        run = run_decision_case(case)
        print(f"\n{'=' * 72}")
        print(f"SCENARIO: {run.name}")
        print(f"{'=' * 72}")
        print(f"Question: {run.user_state.raw_input}")
        print(f"Goals: {run.user_state.goals}")
        for fv in run.feature_vectors:
            rep = run.reliability.get(fv.option_id)
            print(f"\n  Option: {fv.option_id}")
            print(
                f"    features  upside={fv.upside_potential_level} goal={fv.goal_alignment_level} "
                f"downside={fv.downside_severity_level} rev={fv.reversibility_level} "
                f"stress={fv.stress_load_level} missing={fv.missing_critical_info_count}"
            )
            if fv.hard_constraint_violations:
                print(f"    violations {fv.hard_constraint_violations}")
            if rep:
                print(
                    f"    futures   gate={rep.score_use} grounding={rep.grounding_coverage} "
                    f"blocked={rep.blocked_uses[:2]}"
                )
        for e in run.evaluations:
            cs = run.composite_by_id[e.option_id]
            print(
                f"    scores    EV={e.expected_value_score} Risk={e.risk_score} "
                f"Regret={e.regret_score} Unc={e.uncertainty_score} Goal={e.goal_alignment_score} "
                f"composite={cs:.2f}"
            )
        print(f"\n  >>> WINNER: {run.winner_id}")
        print(f"  reasoning: {run.recommendation_reasoning[:120]}...")
    captured = capsys.readouterr()
    assert "WINNER:" in captured.out
